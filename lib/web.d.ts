import { Context } from "@deepseek-ai/cordis";
//#region src/web.d.ts
declare const name = "dsh-updater-web";
declare const inject: string[];
declare function apply(ctx: Context): void;
//#endregion
export { apply, inject, name };