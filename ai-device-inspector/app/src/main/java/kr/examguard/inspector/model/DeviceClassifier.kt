package kr.examguard.inspector.model

/**
 * 신호에 담긴 정보(기기 이름, 제조사 ID, 서비스 UUID, Wi-Fi 이름)로 기기 종류를 추정한다.
 * 모두 추정이며, 기기가 이름을 숨기거나 제조사 정보를 보내지 않으면 '미확인'으로 남는다.
 * 새 기기가 나오면 아래 표에 규칙을 추가하면 된다.
 */
object DeviceClassifier {

    // Bluetooth SIG 회사 식별자 (Company Identifier)
    const val APPLE = 0x004C
    const val MICROSOFT = 0x0006
    const val SAMSUNG = 0x0075
    const val GOOGLE = 0x00E0
    const val META = 0x01AB
    const val META_TECH = 0x058E
    const val GARMIN = 0x0087
    const val XIAOMI = 0x038F
    const val HUAWEI = 0x027D
    const val SONY = 0x012D
    const val BOSE = 0x009E

    private val vendorNames = mapOf(
        APPLE to "Apple",
        MICROSOFT to "Microsoft",
        SAMSUNG to "Samsung",
        GOOGLE to "Google",
        META to "Meta",
        META_TECH to "Meta",
        GARMIN to "Garmin",
        XIAOMI to "Xiaomi",
        HUAWEI to "Huawei",
        SONY to "Sony",
        BOSE to "Bose",
    )

    /** 이름 키워드 → 종류. 위에 있을수록 먼저 적용된다. */
    private val nameRules: List<Pair<List<String>, Category>> = listOf(
        listOf("ray-ban", "rayban", "oakley meta", "meta glass", "smart glass", "glasses",
            "xreal", "nreal", "rokid", "even g1", "even g2", "spectacles", "vuzix", "inmo", "frame")
            to Category.SMART_GLASSES,
        listOf("airpods", "buds", "earbud", "beats", "pods", "wf-", "wh-", "jbl", "qcy", "headset",
            "earphone", "이어폰") to Category.EARBUDS,
        listOf("watch", "워치", "fitbit", "galaxy fit", "mi band", "smart band", "amazfit",
            "garmin", "forerunner", "fenix") to Category.WATCH,
        listOf("ipad", "galaxy tab", "macbook", "laptop", "notebook", "surface", "desktop-", "laptop-")
            to Category.TABLET_PC,
        listOf("iphone", "galaxy", "pixel", "phone", "redmi", "xperia", "폰") to Category.PHONE,
        listOf("airtag", "smarttag", "smart tag", "tile") to Category.TRACKER,
    )

    /** BLE 신호 분류. manufacturerData 의 값은 회사 ID 뒤의 페이로드. serviceUuids 는 대문자 UUID 문자열. */
    fun classifyBle(
        name: String?,
        manufacturerData: Map<Int, ByteArray>,
        serviceUuids: List<String>,
    ): Classification {
        val vendorId = manufacturerData.keys.firstOrNull { it in vendorNames }
        val vendor = vendorId?.let { vendorNames[it] }

        // 1) 이름이 가장 확실한 단서
        matchName(name)?.let { return Classification(it, vendor, "기기 이름으로 판별") }

        // 2) 제조사 신호 구조
        manufacturerData[APPLE]?.let { return classifyApple(it) }
        if (vendorId == META || vendorId == META_TECH) {
            return Classification(Category.SMART_GLASSES, "Meta", "Meta 기기 신호 (스마트안경 가능성 높음)")
        }
        manufacturerData[MICROSOFT]?.let { payload ->
            if (payload.isNotEmpty() && payload[0].toInt() == 0x01) {
                return Classification(Category.TABLET_PC, "Microsoft", "Windows PC 근거리 연결 신호")
            }
        }
        if (vendorId == SAMSUNG) {
            return Classification(Category.PHONE, "Samsung", "삼성 기기 (휴대폰·워치·이어폰 중 하나)")
        }
        if (vendorId == GARMIN || vendorId == HUAWEI || vendorId == XIAOMI) {
            return Classification(Category.WATCH, vendor, "웨어러블 제조사 신호")
        }
        if (vendorId == SONY || vendorId == BOSE) {
            return Classification(Category.EARBUDS, vendor, "음향기기 제조사 신호")
        }

        // 3) 서비스 UUID
        val uuids = serviceUuids.map { it.uppercase() }
        if (uuids.any { it.contains("FE2C") }) {
            return Classification(Category.EARBUDS, vendor ?: "Google Fast Pair", "Fast Pair 신호 (이어폰 등)")
        }
        if (uuids.any { it.contains("FD5A") }) {
            return Classification(Category.TRACKER, "Samsung", "SmartTag 신호")
        }
        if (uuids.any { it.contains("FEED") || it.contains("FEEC") }) {
            return Classification(Category.TRACKER, "Tile", "Tile 위치태그 신호")
        }
        if (vendorId == GOOGLE || uuids.any { it.contains("FEF3") || it.contains("FE9F") }) {
            return Classification(Category.PHONE, "Google", "Android 기기 신호")
        }

        if (vendor != null) return Classification(Category.OTHER_BT, vendor)
        if (manufacturerData.isNotEmpty() || !name.isNullOrBlank()) {
            return Classification(Category.OTHER_BT, null)
        }
        return Classification(Category.UNKNOWN, null)
    }

    /** Apple Continuity 메시지 종류(페이로드 첫 바이트)로 구분 */
    private fun classifyApple(payload: ByteArray): Classification {
        val type = payload.firstOrNull()?.toInt()?.and(0xFF)
        return when (type) {
            0x07 -> Classification(Category.EARBUDS, "Apple", "AirPods·Beats 신호")
            0x12 -> Classification(Category.TRACKER, "Apple", "나의 찾기 신호 (AirTag 또는 꺼진 Apple 기기)")
            0x10, 0x0C, 0x0F, 0x05, 0x09, 0x0B ->
                Classification(Category.PHONE, "Apple", "iPhone·iPad·Apple Watch 계열 신호")
            0x02 -> Classification(Category.OTHER_BT, "Apple", "iBeacon 신호")
            else -> Classification(Category.PHONE, "Apple", "Apple 기기 신호")
        }
    }

    fun matchName(name: String?): Category? {
        val n = name?.lowercase()?.trim().orEmpty()
        if (n.isEmpty()) return null
        return nameRules.firstOrNull { (keys, _) -> keys.any { n.contains(it) } }?.second
    }

    private val hotspotSsidKeys = listOf(
        "iphone", "ipad", "galaxy", "androidap", "android", "hotspot", "핫스팟", "pixel", "redmi",
        "xiaomi", "phone", "direct-", "의 ", "'s ",
    )

    /** Wi-Fi 신호 분류: 휴대폰 핫스팟인지 일반 공유기인지 추정 */
    fun classifyWifi(ssid: String?, bssid: String): Classification {
        val s = ssid?.lowercase().orEmpty()
        val keyword = hotspotSsidKeys.firstOrNull { s.contains(it) }
        if (keyword != null) {
            return Classification(Category.HOTSPOT, null, "Wi-Fi 이름으로 휴대폰 핫스팟 추정")
        }
        if (isLocallyAdministered(bssid)) {
            return Classification(Category.HOTSPOT, null, "무작위 주소 사용 (휴대폰 핫스팟 가능성)")
        }
        return Classification(Category.WIFI_AP, null, "일반 공유기로 추정")
    }

    /** 첫 바이트의 두 번째 비트가 1이면 무작위로 만든 주소. 휴대폰 핫스팟이 흔히 사용 */
    fun isLocallyAdministered(mac: String): Boolean {
        val first = mac.split(":").firstOrNull()?.toIntOrNull(16) ?: return false
        return first and 0x02 != 0
    }
}
