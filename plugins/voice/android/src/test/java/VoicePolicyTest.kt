package com.xinyuan.readingpartner.voice

import android.media.AudioDeviceInfo.TYPE_BLE_HEADSET
import android.media.AudioDeviceInfo.TYPE_BLUETOOTH_SCO
import android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
import android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
import android.media.AudioDeviceInfo.TYPE_HEARING_AID
import android.media.AudioDeviceInfo.TYPE_USB_HEADSET
import android.media.AudioDeviceInfo.TYPE_WIRED_HEADSET
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VoicePolicyTest {
    private val gib8 = 8L * 1024 * 1024 * 1024

    @Test
    fun anEightGigabytePhoneOnApi34HoldsACall() {
        assertTrue(VoicePolicy.callCapable(34, true, 8_000_000_000L, 7_400_000_000L))
        assertTrue(VoicePolicy.callCapable(35, true, gib8, 7_600_000_000L))
    }

    @Test
    fun aSixGigabytePhoneDoesNot() {
        assertFalse(VoicePolicy.callCapable(34, true, 6_000_000_000L, 5_600_000_000L))
        assertFalse(VoicePolicy.callCapable(34, true, 6L * 1024 * 1024 * 1024, 5_900_000_000L))
        assertFalse(VoicePolicy.callCapable(31, true, 0L, 5_700_000_000L))
    }

    @Test
    fun belowApi34TheKernelsTotalIsRead() {
        // advertisedMem does not exist there; whatever is passed is ignored.
        assertTrue(VoicePolicy.callCapable(33, true, 0L, 7_500_000_000L))
        assertFalse(VoicePolicy.callCapable(33, true, gib8, 6_700_000_000L))
        assertTrue(VoicePolicy.callCapable(31, true, 0L, VoicePolicy.MEMORY_FLOOR))
    }

    @Test
    fun onApi34TheAdvertisedFigureDecides() {
        assertTrue(VoicePolicy.callCapable(34, true, 8_000_000_000L, 6_500_000_000L))
        assertFalse(VoicePolicy.callCapable(34, true, 6_000_000_000L, gib8))
    }

    @Test
    fun oldSystemsAndMissingLibrariesAreRefused() {
        assertFalse(VoicePolicy.callCapable(30, true, gib8, gib8))
        assertFalse(VoicePolicy.callCapable(26, true, gib8, gib8))
        assertFalse(VoicePolicy.callCapable(34, false, gib8, gib8))
    }

    @Test
    fun headsetsComeBeforeTheSpeakerInOrder() {
        val all = listOf(TYPE_BUILTIN_EARPIECE, TYPE_BUILTIN_SPEAKER, TYPE_WIRED_HEADSET, TYPE_USB_HEADSET, TYPE_BLUETOOTH_SCO, TYPE_BLE_HEADSET)
        assertEquals(5, VoicePolicy.pickDevice(all))
        assertEquals(4, VoicePolicy.pickDevice(all.take(5)))
        assertEquals(3, VoicePolicy.pickDevice(all.take(4)))
        assertEquals(2, VoicePolicy.pickDevice(all.take(3)))
        assertEquals(1, VoicePolicy.pickDevice(all.take(2)))
    }

    @Test
    fun theSpeakerNotTheEarpieceWhenNothingIsPluggedIn() {
        assertEquals(1, VoicePolicy.pickDevice(listOf(TYPE_BUILTIN_EARPIECE, TYPE_BUILTIN_SPEAKER)))
        assertEquals(0, VoicePolicy.pickDevice(listOf(TYPE_BUILTIN_SPEAKER, TYPE_BUILTIN_EARPIECE)))
    }

    @Test
    fun nothingUsableIsMinusOne() {
        assertEquals(-1, VoicePolicy.pickDevice(emptyList()))
        assertEquals(-1, VoicePolicy.pickDevice(listOf(TYPE_BUILTIN_EARPIECE, TYPE_HEARING_AID)))
    }

    @Test
    fun theFirstOfTwoAlikeIsTaken() {
        assertEquals(1, VoicePolicy.pickDevice(listOf(TYPE_BUILTIN_SPEAKER, TYPE_BLUETOOTH_SCO, TYPE_BLUETOOTH_SCO)))
    }

    @Test
    fun playedFramesCountFromTheLastFlush() {
        assertEquals(480L, VoicePolicy.playedFrames(480, 2_000, 1_000, 960))
        // A stamp from before the flush says nothing about the new frames.
        assertEquals(-1L, VoicePolicy.playedFrames(24_000, 900, 1_000, 480))
        // Never more than was written since the flush, never negative.
        assertEquals(480L, VoicePolicy.playedFrames(2_000, 2_000, 1_000, 480))
        assertEquals(0L, VoicePolicy.playedFrames(-5, 2_000, 1_000, 480))
    }
}
