import { Head } from "@ivlev-dev/silent-core";
import type { SlowPanelVM } from "./slow-panel.vm";

export function PanelFallback(props: { req: string }) {
  return (
    <p class="panel-fallback" data-fallback-req={props.req}>
      Загрузка панели… (req="{props.req}")
    </p>
  );
}

export function SlowPanel(
  this: { vm: SlowPanelVM },
  props: { req: string; title: string; late: boolean },
) {
  if (props.late) {
    Head({ title: `${props.title} · late ${props.req}` });
  }
  return (
    <section class="panel" data-req={props.req}>
      <h2 class="panel-heading">{this.vm.heading}</h2>
      <p class="panel-ready">Панель отрендерена после shell.</p>
      <p class="panel-late">
        {props.late ? "head обновлён в final" : "head без изменений"}
      </p>
    </section>
  );
}
