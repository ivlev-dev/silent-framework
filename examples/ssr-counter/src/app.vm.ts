import { ViewModel } from "@ivlev-dev/silent-core";

export interface AppProps {
  title: string;
}

export class AppVM extends ViewModel<AppProps> {}
