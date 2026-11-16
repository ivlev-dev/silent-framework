export const STREAM_RUNTIME_SCRIPT =
  "(function(){var w=window,s=document.currentScript;if(w.__silentStream){s&&s.remove();return}" +
  "function find(d){var t=document.createTreeWalker(document,128,null),n;" +
  "while((n=t.nextNode())){if(n.data===d)return n}return null}" +
  "function patch(id){var s=find('silent-stream:'+id),e=find('silent-stream-end:'+id)," +
  "t=document.querySelector('template[data-silent-stream=\"'+id+'\"]'),c=document.currentScript,n,x;" +
  "if(s&&e&&t){var p=e.parentNode;n=s.nextSibling;" +
  "while(n&&n!==e){x=n.nextSibling;n.remove();n=x}" +
  "p.insertBefore(t.content,e);s.remove();e.remove()}" +
  "t&&t.remove();c&&c.remove()}" +
  "w.__silentStream={patch:patch};s&&s.remove()})();";

function nonceAttribute(nonce: string | undefined): string {
  return nonce === undefined ? "" : ` nonce="${nonce.replace(/"/g, "&quot;")}"`;
}

export function streamRuntimeTag(
  script: string,
  nonce: string | undefined,
): string {
  return `<script${nonceAttribute(nonce)}>${script}</script>`;
}

export function streamPatch(
  id: number,
  html: string,
  nonce: string | undefined,
): string {
  return (
    `<template data-silent-stream="${id}">${html}</template>` +
    `<script${nonceAttribute(nonce)}>window.__silentStream.patch(${id})</script>`
  );
}
