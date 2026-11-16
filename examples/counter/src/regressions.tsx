import { For, Show, createSignal, mount } from "@ivlev-dev/silent-core";

function Greeting(props: { name: string }) {
  const { name } = props;
  return <span class="greeting">{name}</span>;
}

function Regressions() {
  const [open] = createSignal(true);
  const [text, setText] = createSignal("hello");
  const [other, setOther] = createSignal(0);
  const [selected, setSelected] = createSignal("b");
  const [name, setName] = createSignal("Ann");

  const tick = (): void => {
    setOther(other() + 1);
  };

  const state = globalThis as typeof globalThis & { __silentTick?: () => void };
  state.__silentTick = tick;

  return (
    <main class="regressions">
      <svg class="dynamic-svg">
        <For each={[1]}>
          {() => <path class="icon-path" d="M0 0h8" />}
        </For>
      </svg>

      <svg class="mapped-svg">
        {[1, 2].map((value) => (
          <circle class="mapped-circle" key={value} r={String(value)} />
        ))}
      </svg>

      <style>{`.probe-style { color: rgb(1, 2, 3); }`}</style>
      <p class="probe-style">style</p>

      <Show when={open}>
        <input
          class="show-input"
          value={text()}
          onInput={(event) => setText((event.currentTarget as HTMLInputElement).value)}
        />
      </Show>

      <button class="tick" onClick={tick}>
        tick
      </button>
      <span class="other">{other()}</span>

      <select
        class="native-select"
        value={selected()}
        onChange={(event) =>
          setSelected((event.currentTarget as HTMLSelectElement).value)
        }
      >
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>

      <Greeting name={name()} />
      <button class="rename" onClick={() => setName("Bob")}>
        rename
      </button>
    </main>
  );
}

void mount("#app", Regressions);
