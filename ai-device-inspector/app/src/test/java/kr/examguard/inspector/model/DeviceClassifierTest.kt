package kr.examguard.inspector.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceClassifierTest {

    private fun ble(name: String? = null, mfr: Map<Int, ByteArray> = emptyMap(), uuids: List<String> = emptyList()) =
        DeviceClassifier.classifyBle(name, mfr, uuids).category

    @Test fun smartGlassesByName() {
        assertEquals(Category.SMART_GLASSES, ble("Ray-Ban Meta 1A2B"))
        assertEquals(Category.SMART_GLASSES, ble("XREAL Air"))
    }

    @Test fun metaVendorIsGlasses() {
        assertEquals(Category.SMART_GLASSES, ble(mfr = mapOf(DeviceClassifier.META to byteArrayOf(1))))
    }

    @Test fun appleContinuityTypes() {
        val a = DeviceClassifier.APPLE
        assertEquals(Category.EARBUDS, ble(mfr = mapOf(a to byteArrayOf(0x07, 0x19))))
        assertEquals(Category.PHONE, ble(mfr = mapOf(a to byteArrayOf(0x10, 0x05))))
        assertEquals(Category.TRACKER, ble(mfr = mapOf(a to byteArrayOf(0x12, 0x19))))
    }

    @Test fun nameBeatsVendor() {
        val samsung = mapOf(DeviceClassifier.SAMSUNG to byteArrayOf(0x42))
        assertEquals(Category.WATCH, ble("Galaxy Watch6 (AB12)", samsung))
        assertEquals(Category.EARBUDS, ble("Galaxy Buds2 Pro", samsung))
        assertEquals(Category.PHONE, ble(null, samsung))
    }

    @Test fun fastPairIsEarbuds() {
        assertEquals(Category.EARBUDS, ble(uuids = listOf("0000FE2C-0000-1000-8000-00805F9B34FB")))
    }

    @Test fun emptyIsUnknown() {
        assertEquals(Category.UNKNOWN, ble())
    }

    @Test fun wifiHotspotDetection() {
        assertEquals(Category.HOTSPOT, DeviceClassifier.classifyWifi("홍길동의 iPhone", "a4:83:e7:11:22:33").category)
        assertEquals(Category.HOTSPOT, DeviceClassifier.classifyWifi("AndroidAP_1234", "00:11:22:33:44:55").category)
        assertEquals(Category.HOTSPOT, DeviceClassifier.classifyWifi("abc", "da:a1:19:00:00:01").category)
        assertEquals(Category.WIFI_AP, DeviceClassifier.classifyWifi("SCHOOL_WIFI", "00:11:22:33:44:55").category)
    }

    @Test fun locallyAdministeredBit() {
        assertTrue(DeviceClassifier.isLocallyAdministered("02:00:00:00:00:00"))
        assertFalse(DeviceClassifier.isLocallyAdministered("00:1a:2b:3c:4d:5e"))
    }

    @Test fun maskKeepsLastTwoOctets() {
        assertEquals("**:**:**:**:4D:5E", maskAddress("00:1A:2B:3C:4D:5E"))
    }

    @Test fun distanceGrowsAsSignalWeakens() {
        assertTrue(DetectedDevice.estimateDistance(-80.0) > DetectedDevice.estimateDistance(-50.0))
    }
}
