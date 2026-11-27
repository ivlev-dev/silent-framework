use std::cell::{Cell, RefCell};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;

use ui_core::signal::Signal;
use ui_core::widget::{DataColumn, DataTableState};

use crate::api::{
    format_budget, format_date, load_projects, Project, ProjectMeta, ProjectQuery, ProjectStatus,
    SortField,
};

pub const COLUMNS: usize = 6;

pub struct ProjectsState {
    pub items: Signal<Vec<Project>>,
    pub total: Signal<usize>,
    pub page: Signal<usize>,
    pub page_size_index: Signal<usize>,
    pub selected: Signal<Vec<usize>>,
    pub sort: Signal<Option<usize>>,
    pub ascending: Signal<bool>,
    pub compact: Signal<bool>,
    pub internal_scroll: Signal<bool>,
    pub search: Signal<String>,
    pub status_index: Signal<usize>,
    pub page_scroll: Signal<f32>,
    pub loading: Signal<bool>,
    pub error: Signal<Option<String>>,
    pub meta: Signal<Option<ProjectMeta>>,
    pub order: Signal<Vec<usize>>,
    pub widths: Signal<Vec<f32>>,
    pub scroll: Signal<f32>,
    pub refresh_signal: Signal<bool>,
    rx: RefCell<Option<Receiver<Message>>>,
    generation: Cell<u64>,
    last_key: RefCell<String>,
    started: Cell<bool>,
}

struct Message {
    generation: u64,
    result: Result<(crate::api::ProjectPage, Option<ProjectMeta>), String>,
}

const PAGE_SIZES: [usize; 4] = [10, 20, 50, 100];

impl ProjectsState {
    pub fn new() -> Self {
        Self {
            items: Signal::new(Vec::new()),
            total: Signal::new(0),
            page: Signal::new(0),
            page_size_index: Signal::new(0),
            selected: Signal::new(Vec::new()),
            sort: Signal::new(Some(5)),
            ascending: Signal::new(false),
            compact: Signal::new(false),
            internal_scroll: Signal::new(true),
            search: Signal::new(String::new()),
            status_index: Signal::new(0),
            page_scroll: Signal::new(0.0),
            loading: Signal::new(false),
            error: Signal::new(None),
            meta: Signal::new(None),
            order: Signal::new((0..COLUMNS).collect()),
            widths: Signal::new(vec![240.0, 180.0, 130.0, 220.0, 110.0, 130.0]),
            scroll: Signal::new(0.0),
            refresh_signal: Signal::new(false),
            rx: RefCell::new(None),
            generation: Cell::new(0),
            last_key: RefCell::new(String::new()),
            started: Cell::new(false),
        }
    }

    pub fn page_size(&self) -> usize {
        PAGE_SIZES[self.page_size_index.peek().min(PAGE_SIZES.len() - 1)]
    }

    pub fn status(&self) -> Option<ProjectStatus> {
        match self.status_index.peek() {
            1 => Some(ProjectStatus::Active),
            2 => Some(ProjectStatus::Review),
            3 => Some(ProjectStatus::Done),
            4 => Some(ProjectStatus::Paused),
            _ => None,
        }
    }

    pub fn sort_field(&self) -> SortField {
        match self.sort.peek().unwrap_or(5) {
            0 => SortField::Name,
            1 => SortField::Owner,
            2 => SortField::Status,
            4 => SortField::Budget,
            _ => SortField::CreatedAt,
        }
    }

    pub fn query(&self) -> ProjectQuery {
        ProjectQuery {
            page: self.page.peek(),
            page_size: self.page_size(),
            sort: self.sort_field(),
            ascending: self.ascending.peek(),
            search: self.search.peek(),
            status: self.status(),
        }
    }

    pub fn on_frame(&self) {
        if self.refresh_signal.peek() {
            self.refresh_signal.set(false);
            self.refresh();
        }
        self.poll();
        if !self.started.get() || self.query().to_query_string() != *self.last_key.borrow() {
            self.started.set(true);
            self.start();
        }
    }

    pub fn needs_frame(&self) -> bool {
        self.loading.peek() || self.rx.borrow().is_some()
    }

    pub fn refresh(&self) {
        self.last_key.borrow_mut().clear();
        self.start();
    }

    pub fn load_blocking(&self) {
        self.refresh();
        for _ in 0..200 {
            self.poll();
            if !self.loading.peek() {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    fn start(&self) {
        let query = self.query();
        let key = query.to_query_string();
        let generation = self.generation.get() + 1;
        self.generation.set(generation);
        *self.last_key.borrow_mut() = key;
        self.loading.set(true);
        self.error.set(None);
        let (tx, rx) = mpsc::channel();
        *self.rx.borrow_mut() = Some(rx);
        thread::spawn(move || {
            let result = load_projects(&query);
            let _ = tx.send(Message { generation, result });
        });
    }

    fn poll(&self) {
        let message = {
            let mut guard = self.rx.borrow_mut();
            let Some(rx) = guard.as_ref() else {
                return;
            };
            match rx.try_recv() {
                Ok(message) => {
                    *guard = None;
                    Some(message)
                }
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => {
                    *guard = None;
                    self.loading.set(false);
                    self.error
                        .set(Some("фоновый запрос завершился без ответа".into()));
                    None
                }
            }
        };
        let Some(message) = message else {
            return;
        };
        if message.generation != self.generation.get() {
            return;
        }
        self.loading.set(false);
        match message.result {
            Ok((page, meta)) => {
                let total = page.total as usize;
                let size = page.page_size.max(1) as usize;
                let max_page = total.saturating_sub(1) / size;
                if self.page.peek() > max_page {
                    self.page.set(max_page);
                }
                self.items.set(page.items);
                self.total.set(total);
                self.selected.set(Vec::new());
                self.scroll.set(0.0);
                if let Some(meta) = meta {
                    self.meta.set(Some(meta));
                }
            }
            Err(error) => {
                self.error.set(Some(error));
                self.items.set(Vec::new());
                self.total.set(0);
            }
        }
    }

    pub fn pages(&self) -> usize {
        self.total.peek().div_ceil(self.page_size()).max(1)
    }

    pub fn table_state(&self, pages: usize) -> DataTableState {
        DataTableState {
            order: self.order,
            widths: self.widths,
            compact: self.compact,
            selected: self.selected,
            sort: self.sort,
            sort_ascending: self.ascending,
            page: self.page,
            pages,
            scroll: self.scroll,
        }
    }

    pub fn columns() -> Vec<DataColumn> {
        [
            ("Проект", 240.0),
            ("Владелец", 180.0),
            ("Статус", 130.0),
            ("Теги", 220.0),
            ("Бюджет", 110.0),
            ("Создан", 130.0),
        ]
        .into_iter()
        .map(|(title, width)| DataColumn {
            title: title.to_string(),
            width,
            align: ui_core::geometry::Align::Start,
            tag: (title == "Статус").then_some(ui_core::widget::TagVariant::Primary),
        })
        .collect()
    }

    pub fn display_range(&self) -> (usize, usize, usize) {
        let total = self.total.peek();
        let size = self.page_size();
        let first = self.page.peek() * size + 1;
        let count = self.items.peek().len();
        let last = (first + count.saturating_sub(1)).min(total.max(first));
        (first, last, total)
    }

    pub fn rows(&self) -> Vec<Vec<String>> {
        self.items
            .peek()
            .iter()
            .map(|project| {
                vec![
                    project.name.clone(),
                    project.owner.clone(),
                    project.status.label().to_string(),
                    project.tags.join(" · "),
                    format_budget(project.budget),
                    format_date(project.created_at),
                ]
            })
            .collect()
    }

    pub fn status_options() -> Vec<String> {
        std::iter::once("Все статусы".to_string())
            .chain(
                ProjectStatus::ALL
                    .into_iter()
                    .map(|status| status.label().to_string()),
            )
            .collect()
    }

    pub fn page_size_options() -> Vec<String> {
        PAGE_SIZES.iter().map(|size| size.to_string()).collect()
    }
}
