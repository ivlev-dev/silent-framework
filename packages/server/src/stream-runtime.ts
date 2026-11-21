export const STREAM_RUNTIME_SCRIPT =
  "(function(){var w=window,c=document.currentScript;if(w.__silentStream){c&&c.remove();return}" +
  "function prev(n){if(n.previousSibling){n=n.previousSibling;while(n.lastChild){n=n.lastChild}return n}return n.parentNode}" +
  "function patch(id){var c=document.currentScript,t=c?c.previousElementSibling:null,e=null,s=null,n,x;" +
  "if(!t||t.tagName!=='TEMPLATE'||t.getAttribute('data-silent-stream')!==''+id){" +
  "t=document.querySelector('template[data-silent-stream=\"'+id+'\"]')}" +
  "if(!t){c&&c.remove();return}" +
  "e=t.previousSibling;" +
  "if(!e||e.nodeType!==8||e.data!=='silent-stream-end:'+id){e=null;" +
  "for(n=prev(t);n;n=prev(n)){if(n.nodeType===8&&n.data==='silent-stream-end:'+id){e=n;break}}}" +
  "if(e){for(n=e.previousSibling;n;n=n.previousSibling){" +
  "if(n.nodeType===8&&n.data==='silent-stream:'+id){s=n;break}}}" +
  "if(s&&e&&t){var p=e.parentNode;n=s.nextSibling;" +
  "while(n&&n!==e){x=n.nextSibling;n.remove();n=x}" +
  "p.insertBefore(t.content,e);s.remove();e.remove()}" +
  "t&&t.remove();c&&c.remove()}" +
  "w.__silentStream={patch:patch};c&&c.remove()})();";

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
