import { computed, ViewModel } from "@ivlev-dev/silent-core";

export interface SlowPanelProps {
  readonly req: string;
  readonly title: string;
  readonly late: boolean;
}

export class SlowPanelVM extends ViewModel<SlowPanelProps> {
  @computed get heading(): string {
    return `Панель req="${this.props.req}"`;
  }
}
