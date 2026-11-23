package dev.ivlev.silent.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FingerprintTest {
    @Test
    fun simpleFingerprint() {
        assertEquals(
            "Simple{age:uint32;createdAt:date;email:string;score:int32}",
            SimpleCodec.schemaFingerprint(),
        )
    }

    @Test
    fun optionalFingerprint() {
        assertEquals(
            "OptionalFields{a:int32?;b:string?;c:bool?;nested:class(Inner)?}",
            OptionalFieldsCodec.schemaFingerprint(),
        )
    }

    @Test
    fun oneOfFingerprint() {
        assertEquals(
            "Event{created:oneof(1,class(CreatedPayload));deleted:oneof(3,unit);" +
                "kind:enum(EventKind);updated:oneof(2,class(UpdatedPayload))}",
            EventCodec.schemaFingerprint(),
        )
    }

    @Test
    fun inheritanceFingerprint() {
        assertEquals("Derived{id:int32;name:string}", DerivedCodec.schemaFingerprint())
        assertEquals("OverriddenValue{extra:string;value:int32}", OverriddenValueCodec.schemaFingerprint())
    }

    @Test
    fun collectionFingerprint() {
        val fingerprint = CollectionsCodec.schemaFingerprint()
        assertTrue(fingerprint.startsWith("Collections{array:array(string);"))
        assertTrue(fingerprint.contains("list:array(int32)"))
        assertTrue(fingerprint.contains("nullableList:array(int32?)"))
        assertTrue(fingerprint.contains("tags:map(string,int32)"))
        assertTrue(fingerprint.contains("optionalValues:map(string,int32?)"))
        assertTrue(fingerprint.contains("texts:set(string)"))
        assertTrue(fingerprint.endsWith("}"))
    }

    @Test
    fun scalarFingerprint() {
        val fingerprint = ScalarsCodec.schemaFingerprint()
        assertTrue(fingerprint.contains("narrow:int32"))
        assertTrue(fingerprint.contains("wide:uint32"))
        assertTrue(fingerprint.contains("compact:float32"))
        assertTrue(fingerprint.contains("fixed:fixed32"))
        assertTrue(fingerprint.contains("fixed64:fixed64"))
        assertTrue(fingerprint.contains("unsigned64:uint64"))
        assertTrue(fingerprint.contains("millis:date"))
        assertTrue(fingerprint.contains("instant:date"))
        assertTrue(fingerprint.contains("data:bytes"))
    }

    @Test
    fun fingerprintIsSortedByUtf8() {
        val fingerprint = SimpleCodec.schemaFingerprint()
        val names = fingerprint.substringAfter('{').substringBefore('}').split(';').map { it.substringBefore(':') }
        assertEquals(names.sortedWith { left, right -> ProtoSort.compareUtf8(left, right) }, names)
    }
}
