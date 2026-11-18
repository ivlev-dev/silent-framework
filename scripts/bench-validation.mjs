import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(root, "packages/validation/dist/index.js");
if (!existsSync(entry)) {
  console.error("bench:validation: нет packages/validation/dist — выполните pnpm build");
  process.exit(2);
}
const { validate, validateProperty, IsEmail, Required } = await import(
  pathToFileURL(entry).href
);

const SCHEMA = Symbol.for("silent.validation.schema");

class Address {}

class Item {}

class Model {}

Model[SCHEMA] = {
  version: 1,
  fields: {
    name: "string",
    email: "string",
    age: "number",
    active: "boolean",
    address: ["class", () => Address],
    items: ["array", ["class", () => Item]],
  },
};
Address[SCHEMA] = { version: 1, fields: { city: "string", zip: "string" } };
Item[SCHEMA] = { version: 1, fields: { title: "string", price: "number" } };

function createModel() {
  const model = new Model();
  model.name = "Ivan";
  model.email = "ivan@example.com";
  model.age = 30;
  model.active = true;
  model.address = new Address();
  model.address.city = "Moscow";
  model.address.zip = "101000";
  model.items = [new Item(), new Item(), new Item()];
  for (const item of model.items) {
    item.title = "book";
    item.price = 10;
  }
  return model;
}

class Decorated {
  email = "";
}

const initializers = [];
function decorate(decorator, name) {
  decorator(undefined, {
    kind: "accessor",
    name,
    static: false,
    private: false,
    addInitializer(initializer) {
      initializers.push(initializer);
    },
  });
}

decorate(Required(), "email");
decorate(IsEmail(), "email");

function createDecorated(email) {
  const instance = new Decorated();
  instance.email = email;
  for (const initializer of initializers) {
    initializer.call(instance);
  }
  return instance;
}

function measure(label, run, iterations) {
  for (let index = 0; index < Math.min(iterations, 20000); index += 1) {
    run();
  }
  const rounds = 7;
  let best = Infinity;
  for (let round = 0; round < rounds; round += 1) {
    const start = performance.now();
    for (let index = 0; index < iterations; index += 1) {
      run();
    }
    const elapsed = performance.now() - start;
    if (elapsed < best) {
      best = elapsed;
    }
  }
  const perOp = (best * 1000) / iterations;
  const ops = Math.round(iterations / (best / 1000));
  console.log(
    `${label.padEnd(24)} ${String(ops).padStart(10)} ops/s  ${perOp.toFixed(2)} us`,
  );
}

const model = createModel();
const validDecorated = createDecorated("ivan@example.com");
const decorated = createDecorated("nope");
const invalid = createModel();
invalid.age = "30";

measure("types", () => validate(model), 200000);
measure("types off", () => validate(model, { types: false }), 2000000);
measure("decorators", () => validate(validDecorated), 200000);
measure("invalid types", () => validate(invalid), 200000);
measure("invalid decorators", () => validate(decorated), 200000);
measure("validateProperty", () => validateProperty(model, "email"), 500000);
