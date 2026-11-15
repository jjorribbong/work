package kr.examguard.inspector

import android.app.Application
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kr.examguard.inspector.model.Category
import kr.examguard.inspector.model.Classification
import kr.examguard.inspector.model.DetectedDevice
import kr.examguard.inspector.model.Source
import kr.examguard.inspector.model.maskAddress
import kr.examguard.inspector.scan.BleScanner
import kr.examguard.inspector.scan.DetectionSink
import kr.examguard.inspector.scan.WifiScanner
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

data class AlertEvent(val time: Long, val device: DetectedDevice)

enum class Filter(val label: String) { SUSPICIOUS("의심 기기"), NEW("신규만"), ALL("전체") }

data class UiState(
    val scanning: Boolean = false,
    val devices: List<DetectedDevice> = emptyList(),
    val baselineAt: Long? = null,
    val baselineCount: Int = 0,
    val alerts: List<AlertEvent> = emptyList(),
    val filter: Filter = Filter.SUSPICIOUS,
    val warnings: List<String> = emptyList(),
    val now: Long = System.currentTimeMillis(),
)

class ScanViewModel(app: Application) : AndroidViewModel(app), DetectionSink {

    private val lock = Any()
    private val devices = HashMap<String, DetectedDevice>()
    private val baseline = HashSet<String>()

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val ble = BleScanner(app, this, ::warn)
    private val wifi = WifiScanner(app, this, ::warn)

    init {
        // 신호가 초당 수십 번 들어오므로 화면은 0.7초마다 한 번씩만 갱신
        viewModelScope.launch {
            while (isActive) {
                publish()
                delay(700)
            }
        }
    }

    fun startScan() {
        _state.update { it.copy(warnings = emptyList(), scanning = true) }
        ble.start()
        wifi.start()
    }

    fun stopScan() {
        ble.stop()
        wifi.stop()
        _state.update { it.copy(scanning = false) }
    }

    fun setFilter(f: Filter) = _state.update { it.copy(filter = f) }

    /** 시험 시작 전: 지금 잡히는 기기(감독관 기기, 교실 공유기 등)를 기준으로 등록 */
    fun registerBaseline() {
        val now = System.currentTimeMillis()
        synchronized(lock) {
            baseline.clear()
            devices.values.filter { !it.isStale(now) }.forEach { baseline += it.key }
            for ((k, d) in devices) devices[k] = d.copy(inBaseline = k in baseline)
        }
        _state.update { it.copy(baselineAt = now, baselineCount = baseline.size, alerts = emptyList()) }
        publish()
    }

    fun clearAll() {
        synchronized(lock) {
            devices.clear()
            baseline.clear()
        }
        _state.update { it.copy(baselineAt = null, baselineCount = 0, alerts = emptyList(), devices = emptyList()) }
    }

    fun device(key: String): DetectedDevice? = synchronized(lock) { devices[key] }

    override fun onDetected(source: Source, address: String, name: String?, rssi: Int, classification: Classification) {
        val key = "${source.name}:$address"
        val now = System.currentTimeMillis()
        var alert: DetectedDevice? = null
        synchronized(lock) {
            val prev = devices[key]
            val updated = if (prev == null) {
                DetectedDevice(key, source, address, name, classification, rssi, rssi.toDouble(), now, now, key in baseline)
            } else {
                prev.copy(
                    name = name ?: prev.name,
                    // 이름이 나중에 들어오면 분류가 더 정확해지므로 갱신
                    classification = if (classification.category != Category.UNKNOWN) classification else prev.classification,
                    rssi = rssi,
                    smoothedRssi = DetectedDevice.smooth(prev.smoothedRssi, rssi),
                    lastSeen = now,
                )
            }
            devices[key] = updated
            val baselineActive = _state.value.baselineAt != null
            if (prev == null && baselineActive && !updated.inBaseline && updated.category.risk >= 2) {
                alert = updated
            }
        }
        alert?.let { d ->
            _state.update { it.copy(alerts = listOf(AlertEvent(now, d)) + it.alerts) }
            vibrate(longArrayOf(0, 250, 120, 250))
        }
    }

    private fun publish() {
        val now = System.currentTimeMillis()
        val list = synchronized(lock) {
            // 10분 넘게 안 잡힌 기기는 목록에서 정리
            devices.entries.removeAll { now - it.value.lastSeen > 10 * 60_000L }
            devices.values.toList()
        }.sortedWith(
            compareBy<DetectedDevice> { it.isStale(now) }
                .thenByDescending { it.category.risk }
                .thenByDescending { it.smoothedRssi },
        )
        _state.update { it.copy(devices = list, now = now) }
    }

    private fun warn(msg: String) {
        _state.update { if (msg in it.warnings) it else it.copy(warnings = it.warnings + msg) }
    }

    fun vibrate(pattern: LongArray) {
        val ctx = getApplication<Application>()
        val vib = if (Build.VERSION.SDK_INT >= 31) {
            (ctx.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            ctx.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        vib.vibrate(VibrationEffect.createWaveform(pattern, -1))
    }

    /** 사후 증빙용 CSV. 개인정보 보호를 위해 주소는 뒤 두 자리만 남긴다 */
    fun exportCsv(): String {
        val fmt = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.KOREA)
        val s = _state.value
        val sb = StringBuilder()
        sb.appendLine("AI기기 인스펙터 탐지 기록,${fmt.format(Date())}")
        s.baselineAt?.let { sb.appendLine("기준 등록 시각,${fmt.format(Date(it))},기준 기기 수,${s.baselineCount}") }
        sb.appendLine()
        sb.appendLine("[경고 기록]")
        sb.appendLine("시각,종류,이름,제조사,신호,주소(일부)")
        for (a in s.alerts.reversed()) {
            val d = a.device
            sb.appendLine(listOf(fmt.format(Date(a.time)), d.category.label, csv(d.displayName()),
                d.classification.vendor.orEmpty(), d.source.label, maskAddress(d.address)).joinToString(","))
        }
        sb.appendLine()
        sb.appendLine("[현재 탐지 목록]")
        sb.appendLine("처음 발견,마지막 발견,종류,이름,제조사,신호,세기(dBm),기준기기,주소(일부)")
        for (d in s.devices.filter { it.category.risk > 0 }) {
            sb.appendLine(listOf(fmt.format(Date(d.firstSeen)), fmt.format(Date(d.lastSeen)), d.category.label,
                csv(d.displayName()), d.classification.vendor.orEmpty(), d.source.label, d.smoothedRssi.toInt(),
                if (d.inBaseline) "예" else "아니오", maskAddress(d.address)).joinToString(","))
        }
        return sb.toString()
    }

    private fun csv(v: String) = "\"" + v.replace("\"", "\"\"") + "\""

    override fun onCleared() {
        stopScan()
    }
}
