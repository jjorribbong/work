package kr.examguard.inspector

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kr.examguard.inspector.ui.InspectorApp

class MainActivity : ComponentActivity() {

    private val vm: ScanViewModel by viewModels()
    private var permissionsGranted by mutableStateOf(false)

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            permissionsGranted = hasAllPermissions()
            if (permissionsGranted) vm.startScan()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // 시험 중 순회할 때 화면이 꺼지지 않도록
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        permissionsGranted = hasAllPermissions()

        setContent {
            InspectorApp(
                vm = vm,
                permissionsGranted = permissionsGranted,
                locationOn = isLocationOn(),
                onRequestPermissions = { permissionLauncher.launch(requiredPermissions()) },
                onShare = ::shareLog,
            )
        }
        if (permissionsGranted) vm.startScan()
    }

    private fun requiredPermissions(): Array<String> = buildList {
        add(Manifest.permission.ACCESS_FINE_LOCATION)
        add(Manifest.permission.ACCESS_COARSE_LOCATION)
        if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_SCAN)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.NEARBY_WIFI_DEVICES)
    }.toTypedArray()

    private fun hasAllPermissions() = requiredPermissions().all {
        ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
    }

    /** Wi-Fi·블루투스 스캔 결과는 휴대폰의 위치 기능이 켜져 있어야 들어온다 */
    private fun isLocationOn(): Boolean {
        val lm = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        return if (Build.VERSION.SDK_INT >= 28) lm.isLocationEnabled
        else lm.isProviderEnabled(LocationManager.GPS_PROVIDER) || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    }

    private fun shareLog() {
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_SUBJECT, "AI기기 인스펙터 탐지 기록")
            putExtra(Intent.EXTRA_TEXT, vm.exportCsv())
        }
        startActivity(Intent.createChooser(send, "탐지 기록 내보내기"))
    }
}
