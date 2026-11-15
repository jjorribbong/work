package kr.examguard.inspector.ui

import android.media.AudioManager
import android.media.ToneGenerator
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilterChip
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kr.examguard.inspector.Filter
import kr.examguard.inspector.ScanViewModel
import kr.examguard.inspector.UiState
import kr.examguard.inspector.model.DetectedDevice
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

private val Danger = Color(0xFFC62828)
private val Warn = Color(0xFFEF6C00)
private val Calm = Color(0xFF2E7D32)
private val Muted = Color(0xFF757575)

private fun riskColor(risk: Int) = when (risk) {
    3 -> Danger
    2 -> Warn
    1 -> Color(0xFF1565C0)
    else -> Muted
}

/** -100 dBm(멀다) ~ -40 dBm(아주 가깝다)을 0~1로 변환 */
private fun proximity(rssi: Double) = ((rssi + 100) / 60).coerceIn(0.0, 1.0).toFloat()

private val timeFmt = SimpleDateFormat("HH:mm:ss", Locale.KOREA)

@Composable
fun InspectorApp(
    vm: ScanViewModel,
    permissionsGranted: Boolean,
    locationOn: Boolean,
    onRequestPermissions: () -> Unit,
    onShare: () -> Unit,
) {
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF1A237E))) {
        Scaffold { pad ->
            Box(Modifier.padding(pad).fillMaxSize()) {
                if (!permissionsGranted) {
                    PermissionScreen(onRequestPermissions)
                } else {
                    val state by vm.state.collectAsStateWithLifecycle()
                    var trackingKey by rememberSaveable { mutableStateOf<String?>(null) }
                    val tracked = trackingKey?.let { k -> state.devices.firstOrNull { it.key == k } }
                    if (trackingKey != null) {
                        TrackScreen(tracked, state.now, onBack = { trackingKey = null })
                    } else {
                        HomeScreen(
                            state = state,
                            locationOn = locationOn,
                            onToggleScan = { if (state.scanning) vm.stopScan() else vm.startScan() },
                            onBaseline = vm::registerBaseline,
                            onClear = vm::clearAll,
                            onFilter = vm::setFilter,
                            onShare = onShare,
                            onTrack = { trackingKey = it.key },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionScreen(onRequest: () -> Unit) {
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("AI기기 인스펙터", fontSize = 26.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(16.dp))
        Text(
            "주변의 켜져 있는 전자기기를 찾으려면 블루투스, 주변 Wi-Fi 기기, 위치 권한이 필요합니다.\n\n" +
                "안드로이드는 무선 신호 스캔을 위치 정보로 취급하기 때문에 위치 권한을 요구합니다. " +
                "이 앱은 위치를 저장하거나 외부로 보내지 않으며, 신호를 듣기만 하고 내보내지 않습니다.",
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRequest) { Text("권한 허용하고 시작") }
    }
}

@Composable
private fun HomeScreen(
    state: UiState,
    locationOn: Boolean,
    onToggleScan: () -> Unit,
    onBaseline: () -> Unit,
    onClear: () -> Unit,
    onFilter: (Filter) -> Unit,
    onShare: () -> Unit,
    onTrack: (DetectedDevice) -> Unit,
) {
    val now = state.now
    val active = state.devices.filter { !it.isStale(now) }
    val suspicious = active.filter { it.category.risk >= 2 && !it.inBaseline }
    val shown = when (state.filter) {
        Filter.SUSPICIOUS -> state.devices.filter { it.category.risk >= 2 && !it.inBaseline }
        Filter.NEW -> state.devices.filter { !it.inBaseline && it.category.risk >= 1 }
        Filter.ALL -> state.devices
    }

    LazyColumn(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("AI기기 인스펙터", fontSize = 22.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text(if (state.scanning) "● 스캔 중" else "○ 정지", color = if (state.scanning) Calm else Muted)
                Spacer(Modifier.width(8.dp))
                Switch(checked = state.scanning, onCheckedChange = { onToggleScan() })
            }
        }

        if (!locationOn || state.warnings.isNotEmpty()) item {
            Card(colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF3E0))) {
                Column(Modifier.padding(12.dp)) {
                    if (!locationOn) Text("⚠ 휴대폰의 위치(GPS) 기능을 켜야 Wi-Fi·블루투스 기기가 잡힙니다.")
                    state.warnings.forEach { Text("⚠ $it") }
                }
            }
        }

        item {
            Card(
                colors = CardDefaults.cardColors(
                    containerColor = if (suspicious.isNotEmpty()) Color(0xFFFFEBEE) else Color(0xFFE8F5E9),
                ),
            ) {
                Column(Modifier.padding(16.dp)) {
                    Text(
                        if (suspicious.isNotEmpty()) "의심 기기 ${suspicious.size}대 감지" else "의심 기기 없음",
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (suspicious.isNotEmpty()) Danger else Calm,
                    )
                    Text("현재 신호 ${active.size}개 · 블루투스 ${active.count { it.source.name == "BLE" }} · Wi-Fi ${active.count { it.source.name == "WIFI" }}",
                        color = Muted, fontSize = 13.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        state.baselineAt?.let { "기준 등록: ${timeFmt.format(Date(it))} (기기 ${state.baselineCount}개 제외 중)" }
                            ?: "시험 시작 전에 '기준 등록'을 누르면 원래 있던 기기(감독관 폰, 교실 공유기 등)는 경고에서 빠집니다.",
                        fontSize = 13.sp,
                    )
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = onBaseline, modifier = Modifier.weight(1f)) {
                            Text(if (state.baselineAt == null) "기준 등록" else "기준 다시 등록")
                        }
                        OutlinedButton(onClick = onShare, modifier = Modifier.weight(1f)) { Text("기록 내보내기") }
                    }
                }
            }
        }

        if (state.alerts.isNotEmpty()) {
            item { Text("시험 중 새로 나타난 기기", fontWeight = FontWeight.Bold, color = Danger) }
            items(state.alerts.take(5), key = { "alert-${it.time}-${it.device.key}" }) { a ->
                Text(
                    "${timeFmt.format(Date(a.time))}  ${a.device.category.emoji} ${a.device.category.label} · ${a.device.displayName()}",
                    fontSize = 14.sp,
                    modifier = Modifier.clickable { onTrack(a.device) },
                )
            }
        }

        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Filter.entries.forEach { f ->
                    FilterChip(selected = state.filter == f, onClick = { onFilter(f) }, label = { Text(f.label) })
                }
            }
        }

        if (shown.isEmpty()) item {
            Text(
                if (state.scanning) "표시할 기기가 없습니다." else "스캔이 꺼져 있습니다.",
                color = Muted,
                modifier = Modifier.padding(vertical = 24.dp).fillMaxWidth(),
                textAlign = TextAlign.Center,
            )
        }
        items(shown, key = { it.key }) { d -> DeviceRow(d, now, onClick = { onTrack(d) }) }

        item {
            TextButton(onClick = onClear) { Text("모든 기록 지우기", color = Muted) }
            Text(
                "※ 비행기 모드이거나 블루투스·Wi-Fi가 꺼진 기기, LTE/5G 통신만 하는 휴대폰은 탐지할 수 없습니다. 금속탐지기·전파탐지기와 함께 쓰세요.",
                fontSize = 12.sp, color = Muted,
            )
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun DeviceRow(d: DetectedDevice, now: Long, onClick: () -> Unit) {
    val stale = d.isStale(now)
    Card(
        Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = if (stale) Color(0xFFF5F5F5) else Color.White),
        elevation = CardDefaults.cardElevation(1.dp),
    ) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(d.category.emoji, fontSize = 28.sp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(d.category.label, color = if (stale) Muted else riskColor(d.category.risk), fontWeight = FontWeight.Bold)
                    if (!d.inBaseline && d.category.risk >= 2) Badge("신규", Danger)
                    if (d.inBaseline) Badge("기준", Muted)
                    if (stale) Badge("신호 끊김", Muted)
                }
                Text(d.displayName(), maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    listOfNotNull(d.source.label, d.classification.vendor, d.classification.detail).joinToString(" · "),
                    fontSize = 12.sp, color = Muted, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                LinearProgressIndicator(
                    progress = { proximity(d.smoothedRssi) },
                    modifier = Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)),
                    color = if (stale) Muted else riskColor(d.category.risk),
                )
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text("${d.smoothedRssi.toInt()} dBm", fontSize = 13.sp)
                Text("약 ${"%.1f".format(d.estimatedMeters())}m", fontSize = 12.sp, color = Muted)
            }
        }
    }
}

@Composable
private fun Badge(text: String, color: Color) {
    Spacer(Modifier.width(6.dp))
    Text(
        text,
        color = Color.White,
        fontSize = 11.sp,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(color).padding(horizontal = 6.dp, vertical = 1.dp),
    )
}

/** 기기 하나를 골라 걸어 다니며 위치를 좁혀 가는 화면 (가까울수록 소리가 빨라짐) */
@Composable
private fun TrackScreen(device: DetectedDevice?, now: Long, onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    var beep by remember { mutableStateOf(true) }
    val rssi by rememberUpdatedState(device?.smoothedRssi)
    val stale by rememberUpdatedState(device?.isStale(now) ?: true)

    val tone = remember { ToneGenerator(AudioManager.STREAM_MUSIC, 80) }
    DisposableEffect(Unit) { onDispose { tone.release() } }
    LaunchedEffect(beep) {
        while (beep) {
            val r = rssi
            if (r == null || stale) { delay(500); continue }
            tone.startTone(ToneGenerator.TONE_PROP_BEEP, 60)
            // 멀면 1.5초 간격, 아주 가까우면 0.12초 간격
            delay((1500 - proximity(r) * 1380).toLong())
        }
    }

    Column(
        Modifier.fillMaxSize().padding(20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("← 목록") }
            Spacer(Modifier.weight(1f))
            Text("소리")
            Spacer(Modifier.width(6.dp))
            Switch(checked = beep, onCheckedChange = { beep = it })
        }
        if (device == null) {
            Spacer(Modifier.height(40.dp))
            Text("기기 신호가 사라졌습니다.", color = Muted)
            return@Column
        }
        Spacer(Modifier.height(24.dp))
        Text(device.category.emoji, fontSize = 56.sp)
        Text(device.category.label, fontSize = 22.sp, fontWeight = FontWeight.Bold, color = riskColor(device.category.risk))
        Text(device.displayName(), color = Muted)
        Spacer(Modifier.height(32.dp))

        val p = proximity(device.smoothedRssi)
        val (label, color) = when {
            stale -> "신호 끊김" to Muted
            p > 0.75f -> "바로 근처" to Danger
            p > 0.5f -> "가까움" to Warn
            p > 0.25f -> "보통" to Color(0xFF1565C0)
            else -> "멀리 있음" to Muted
        }
        Box(
            Modifier.size(220.dp).clip(RoundedCornerShape(110.dp)).background(color.copy(alpha = 0.12f + 0.5f * p)),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(label, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = color)
                Text("${device.smoothedRssi.toInt()} dBm", fontSize = 18.sp)
                Text("약 ${"%.1f".format(device.estimatedMeters())}m", color = Muted)
            }
        }
        Spacer(Modifier.height(32.dp))
        Text(
            "휴대폰을 들고 천천히 걸으며 숫자가 커지는(0에 가까워지는) 쪽으로 이동하세요. " +
                "몸이나 가방이 신호를 막으면 숫자가 흔들릴 수 있습니다.",
            textAlign = TextAlign.Center, color = Muted, fontSize = 14.sp,
        )
        Spacer(Modifier.height(12.dp))
        Text(
            listOfNotNull(device.source.label, device.classification.vendor, device.address).joinToString(" · "),
            fontSize = 12.sp, color = Muted,
        )
    }
}
