import { renderToString } from "@ivlev-dev/silent-server";
import { silentApp } from "./ssr-app";

const { html } = await renderToString(silentApp as never, {});
process.stdout.write(html);
