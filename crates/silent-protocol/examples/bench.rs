use std::hint::black_box;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use silent_protocol::SilentProto;

#[derive(Debug, PartialEq, Serialize, Deserialize, SilentProto)]
struct Address {
    city: String,
    zip: i32,
}

#[derive(Debug, PartialEq, Serialize, Deserialize, SilentProto)]
struct User {
    id: i64,
    name: String,
    email: Option<String>,
    age: i32,
    active: bool,
    address: Address,
    tags: Vec<String>,
    score: f64,
}

fn sample() -> User {
    User {
        id: 1234567890123,
        name: "Ivan".into(),
        email: Some("user@example.com".into()),
        age: 30,
        active: true,
        address: Address {
            city: "Москва".into(),
            zip: 101000,
        },
        tags: vec!["a".into(), "b".into()],
        score: 12.5,
    }
}

fn bench<F: FnMut()>(label: &str, bytes: usize, mut run: F) {
    for _ in 0..20_000 {
        run();
    }
    let iterations = 200_000u32;
    let mut best = f64::INFINITY;
    for _ in 0..5 {
        let start = Instant::now();
        for _ in 0..iterations {
            run();
        }
        let elapsed = start.elapsed().as_secs_f64();
        if elapsed < best {
            best = elapsed;
        }
    }
    let ops = f64::from(iterations) / best;
    let mb = ops * bytes as f64 / 1_000_000.0;
    println!("{label:<20} {ops:>10.0} ops/s  {mb:>6.1} MB/s");
}

fn main() {
    let value = sample();
    let bytes = value.encode().unwrap();
    let json = serde_json::to_string(&value).unwrap();
    let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    println!("size {} B, json {} B, hex {hex}", bytes.len(), json.len());

    bench("static encode", bytes.len(), || {
        black_box(black_box(&value).encode().unwrap());
    });
    bench("static decode", bytes.len(), || {
        black_box(User::decode(black_box(&bytes)).unwrap());
    });
    bench("json stringify", json.len(), || {
        black_box(serde_json::to_string(black_box(&value)).unwrap());
    });
    bench("json parse", json.len(), || {
        black_box(serde_json::from_str::<User>(black_box(&json)).unwrap());
    });
}
