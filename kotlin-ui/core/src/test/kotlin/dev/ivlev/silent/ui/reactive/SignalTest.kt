package dev.ivlev.silent.ui.reactive

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SignalTest {
    @Test
    fun effectSubscribesToReadSignals() {
        val signal = MutableSignal(1)
        val other = MutableSignal(0)
        var runs = 0
        var seen = 0
        val effect = Effect {
            runs += 1
            seen = signal.value
        }
        assertEquals(1, runs)
        assertEquals(1, seen)
        other.set(10)
        assertEquals(1, runs)
        signal.set(2)
        assertEquals(2, runs)
        assertEquals(2, seen)
        effect.dispose()
        signal.set(3)
        assertEquals(2, runs)
    }

    @Test
    fun batchRunsEffectOnce() {
        val signal = MutableSignal(0)
        var runs = 0
        val effect = Effect {
            runs += 1
            signal.value
        }
        batch {
            signal.set(1)
            signal.set(2)
            signal.set(3)
        }
        assertEquals(2, runs)
        assertEquals(3, signal.value)
        effect.dispose()
    }

    @Test
    fun computedMemoizesAndInvalidates() {
        val source = MutableSignal(2)
        var computations = 0
        val doubled = Computed {
            computations += 1
            source.value * 2
        }
        assertEquals(4, doubled.value)
        assertEquals(4, doubled.value)
        assertEquals(1, computations)
        source.set(5)
        assertEquals(10, doubled.value)
        assertEquals(2, computations)
    }

    @Test
    fun computedNotifiesSubscriberWithNextValue() {
        val source = MutableSignal(1)
        val doubled = Computed { source.value * 2 }
        var last = 0
        val subscription = doubled.subscribe { last = it }
        source.set(4)
        assertEquals(8, last)
        subscription.dispose()
        source.set(10)
        assertEquals(8, last)
    }

    @Test
    fun scopeDisposesEffectsAndSignals() {
        val scope = Scope()
        val signal = MutableSignal(0)
        var runs = 0
        scope.effect {
            runs += 1
            signal.value
        }
        signal.set(1)
        assertEquals(2, runs)
        scope.dispose()
        assertTrue(scope.isDisposed)
        signal.set(2)
        assertEquals(2, runs)
    }

    @Test
    fun dependencyTrackerReportsChanges() {
        val signal = MutableSignal(0)
        var changes = 0
        val tracker = DependencyTracker { changes += 1 }
        tracker.track { signal.value }
        signal.set(1)
        assertEquals(1, changes)
        signal.set(2)
        assertEquals(2, changes)
        tracker.dispose()
        signal.set(3)
        assertEquals(2, changes)
    }
}
