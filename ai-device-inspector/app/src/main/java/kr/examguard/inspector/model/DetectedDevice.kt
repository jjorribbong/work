package kr.examguard.inspector.model

import kotlin.math.pow

enum class Source(val label: String) { BLE("블루투스"), WIFI("Wi-Fi") }

/** risk: 0 = 무시, 1 = 참고, 2 = 주의, 3 = 경고 */
enum class Category(val label: String, val emoji: String, val risk: Int) {
    SMART_GLASSES("스마트안경", "👓", 3),
    PHONE("휴대폰", "📱", 3),
    HOTSPOT("핫스팟", "📶", 3),
    WATCH("스마트워치", "⌚", 3),
    EARBUDS("무선이어폰", "🎧", 2),
    TABLET_PC("태블릿·노트북", "💻", 2),
    TRACKER("위치태그", "🏷️", 1),
    OTHER_BT("기타 블루투스", "🔵", 1),
    UNKNOWN("미확인", "❔", 1),
    WIFI_AP("Wi-Fi 공유기", "🛜", 0),
}

data class Classification(
    val category: Category,
    val vendor: String?,
    val detail: String? = null,
)

data class DetectedDevice(
    val key: String,
    val source: Source,
    val address: String,
    val name: String?,
    val classification: Classification,
    val rssi: Int,
    val smoothedRssi: Double,
    val firstSeen: Long,
    val lastSeen: Long,
    /** 시험 시작 전 '기준 등록' 때 이미 있던 기기 */
    val inBaseline: Boolean,
) {
    val category get() = classification.category

    fun displayName(): String = name?.takeIf { it.isNotBlank() }
        ?: classification.vendor?.let { "$it 기기" }
        ?: "이름 없는 기기"

    /** 신호가 한동안 안 잡힘 (꺼졌거나 멀어짐). Wi-Fi는 30초마다 스캔하므로 더 길게 기다린다 */
    fun isStale(now: Long) = now - lastSeen > if (source == Source.WIFI) WIFI_STALE_MS else STALE_MS

    /** 아주 대략적인 거리(m). 기기마다 송신 세기가 달라 참고용으로만 씀 */
    fun estimatedMeters(): Double = estimateDistance(smoothedRssi)

    companion object {
        const val STALE_MS = 30_000L
        const val WIFI_STALE_MS = 80_000L

        fun estimateDistance(rssi: Double, txPowerAt1m: Double = -59.0, n: Double = 2.5): Double =
            10.0.pow((txPowerAt1m - rssi) / (10 * n))

        /** 지수이동평균으로 신호 세기 흔들림을 줄임 */
        fun smooth(previous: Double?, current: Int, alpha: Double = 0.3): Double =
            if (previous == null) current.toDouble() else previous + alpha * (current - previous)
    }
}

/** 개인정보 보호를 위해 내보내기 기록에는 주소 앞부분을 가림 */
fun maskAddress(address: String): String {
    val parts = address.split(":")
    if (parts.size != 6) return "**"
    return "**:**:**:**:" + parts[4] + ":" + parts[5]
}
