package kr.examguard.inspector.scan

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import kr.examguard.inspector.model.Classification
import kr.examguard.inspector.model.DeviceClassifier
import kr.examguard.inspector.model.Source

/** 스캐너가 기기를 발견할 때마다 호출된다 */
fun interface DetectionSink {
    fun onDetected(source: Source, address: String, name: String?, rssi: Int, classification: Classification)
}

/**
 * 블루투스 저전력(BLE) 광고 신호 스캐너.
 * 안드로이드는 30분 넘게 계속된 스캔을 저전력 모드로 낮추므로 10분마다 스캔을 다시 시작한다.
 */
class BleScanner(context: Context, private val sink: DetectionSink, private val onError: (String) -> Unit) {
    private val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private val handler = Handler(Looper.getMainLooper())
    private var running = false

    val isBluetoothOn: Boolean get() = adapter?.isEnabled == true

    private val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) = handle(result)
        override fun onBatchScanResults(results: MutableList<ScanResult>) = results.forEach(::handle)
        override fun onScanFailed(errorCode: Int) {
            onError("블루투스 스캔 실패 (코드 $errorCode)")
        }
    }

    private fun handle(result: ScanResult) {
        val record = result.scanRecord
        val mfr = buildMap {
            val sparse = record?.manufacturerSpecificData
            if (sparse != null) for (i in 0 until sparse.size()) put(sparse.keyAt(i), sparse.valueAt(i))
        }
        val uuids = record?.serviceUuids?.map { it.uuid.toString().uppercase() }.orEmpty()
        val name = record?.deviceName
        sink.onDetected(
            Source.BLE,
            result.device.address,
            name,
            result.rssi,
            DeviceClassifier.classifyBle(name, mfr, uuids),
        )
    }

    private val restart = object : Runnable {
        override fun run() {
            if (!running) return
            stopInternal()
            startInternal()
            handler.postDelayed(this, RESTART_MS)
        }
    }

    fun start() {
        if (running) return
        running = true
        startInternal()
        handler.postDelayed(restart, RESTART_MS)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(restart)
        stopInternal()
    }

    @SuppressLint("MissingPermission")
    private fun startInternal() {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null || !isBluetoothOn) {
            onError("블루투스가 꺼져 있습니다")
            return
        }
        val settings = ScanSettings.Builder()
            .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
            .setReportDelay(0)
            .build()
        try {
            scanner.startScan(null, settings, callback)
        } catch (e: SecurityException) {
            onError("블루투스 권한이 없습니다")
        }
    }

    @SuppressLint("MissingPermission")
    private fun stopInternal() {
        try {
            if (isBluetoothOn) adapter?.bluetoothLeScanner?.stopScan(callback)
        } catch (e: Exception) {
            Log.w(TAG, "stopScan", e)
        }
    }

    companion object {
        private const val TAG = "BleScanner"
        private const val RESTART_MS = 10 * 60 * 1000L
    }
}

/**
 * Wi-Fi 스캐너. 안드로이드는 앱이 2분에 4번까지만 스캔을 요청할 수 있게 제한하므로 30초마다 요청한다.
 * 핫스팟을 켠 휴대폰은 공유기처럼 보이므로 여기서 잡힌다.
 */
class WifiScanner(private val context: Context, private val sink: DetectionSink, private val onError: (String) -> Unit) {
    private val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    private val handler = Handler(Looper.getMainLooper())
    private var running = false

    val isWifiOn: Boolean get() = wifi.isWifiEnabled

    private val receiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) = deliverResults()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!running) return
            @Suppress("DEPRECATION")
            val ok = try { wifi.startScan() } catch (e: SecurityException) { false }
            if (!ok) deliverResults() // 요청이 제한돼도 마지막 결과는 읽을 수 있음
            handler.postDelayed(this, INTERVAL_MS)
        }
    }

    fun start() {
        if (running) return
        if (!isWifiOn) onError("Wi-Fi가 꺼져 있어 핫스팟을 찾을 수 없습니다")
        running = true
        context.registerReceiver(receiver, IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION))
        handler.post(tick)
    }

    fun stop() {
        if (!running) return
        running = false
        handler.removeCallbacks(tick)
        try { context.unregisterReceiver(receiver) } catch (_: IllegalArgumentException) {}
    }

    @SuppressLint("MissingPermission")
    private fun deliverResults() {
        val results = try { wifi.scanResults } catch (e: SecurityException) {
            onError("Wi-Fi 스캔 권한이 없습니다"); return
        }
        val nowMicros = android.os.SystemClock.elapsedRealtime() * 1000
        for (r in results) {
            // 시스템이 보관한 오래된 결과는 제외 (지금 켜져 있는 기기만)
            if (nowMicros - r.timestamp > MAX_RESULT_AGE_MICROS) continue
            @Suppress("DEPRECATION")
            val ssid = r.SSID?.removeSurrounding("\"")?.takeIf { it.isNotBlank() && it != "<unknown ssid>" }
            val bssid = r.BSSID ?: continue
            sink.onDetected(Source.WIFI, bssid, ssid, r.level, DeviceClassifier.classifyWifi(ssid, bssid))
        }
    }

    companion object {
        private const val INTERVAL_MS = 30_000L
        private const val MAX_RESULT_AGE_MICROS = 90_000_000L
    }
}
