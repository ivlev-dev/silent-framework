package dev.ivlev.silent.ui.demo

import dev.ivlev.silent.ui.layout.ScrollState
import dev.ivlev.silent.ui.lifecycle.ViewModel
import dev.ivlev.silent.ui.widgets.DataState
import dev.ivlev.silent.ui.widgets.TableDensity
import dev.ivlev.silent.ui.widgets.TableState
import java.time.LocalDate

class GalleryVM : ViewModel() {
    val section = signal("foundations")
    val form = LoginForm()
    val scroll = ScrollState()

    init {
        form.email = "anna@silent.dev"
    }
    val email = signal("anna@silent.dev")
    val text = signal("Silent UI")
    val textarea = signal("Реактивные формы, токены и нативные рендереры.")
    val number = signal("12")
    val select = signal("Дизайн")
    val combo = signal("Silent")
    val otp = signal("123456")
    val tags = signal(listOf("kotlin", "ui", "android"))
    val checkboxA = signal(true)
    val checkboxB = signal(false)
    val checkboxC = signal(true)
    val selectedChecks = signal(setOf("one", "three"))
    val radio = signal("two")
    val switch = signal(true)
    val slider = signal(64f)
    val tree = signal(setOf("src", "ui"))
    val date = signal<LocalDate?>(LocalDate.of(2026, 11, 27))
    val dateEnd = signal<LocalDate?>(LocalDate.of(2026, 12, 5))
    val accordion = signal(setOf(0))
    val page = signal(2)
    val dataSelected = signal(setOf(1))
    val dataState = signal(DataState.Ready)
    val tableState = TableState()
    val sortKey = signal("name")
    val sortDir = signal("ascending")
    val dialogOpen = signal(false)
    val drawerOpen = signal(false)
    val sheetOpen = signal(false)
    val snackbarOpen = signal(true)
    val selectedTab = signal(0)
    val segment = signal("list")
    val selectedColor = signal("#0E2A47")

    fun selectSection(value: String) {
        section.set(value)
        scroll.scrollTo(0f)
    }

    fun closeOverlays() {
        dialogOpen.set(false)
        drawerOpen.set(false)
        sheetOpen.set(false)
    }

    fun toggleAccordion(index: Int) {
        accordion.set(
            if (index in accordion.value) accordion.value - index else accordion.value + index,
        )
    }

    fun onPage(value: Int) {
        page.set(value.coerceIn(1, 5))
    }

    fun toggleRow(index: Int, selected: Boolean) {
        dataSelected.set(
            if (selected) dataSelected.value + index else dataSelected.value - index,
        )
    }

    fun sort(key: String) {
        if (sortKey.value == key) {
            sortDir.set(if (sortDir.value == "ascending") "descending" else "ascending")
        } else {
            sortKey.set(key)
            sortDir.set("ascending")
        }
    }
}
