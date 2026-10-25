import { screen,waitFor,isInaccessible } from "@testing-library/react";
import { expect } from "vitest";
type Scope=Pick<typeof screen,"queryAllByText">;
/** Text narrows candidates before expensive jsdom style/name checks. Visibility and accessible name remain mandatory. */
export function getButton(name:string|RegExp,scope:Scope=screen,opts:{enabled?:boolean}={}):HTMLButtonElement {
 const candidates=[...new Set(scope.queryAllByText(name,{selector:"button, button *"}).map(node=>node.closest("button")))].filter((node):node is HTMLButtonElement=>node!==null&&(!opts.enabled||!node.disabled)&&!isInaccessible(node));
 if(candidates.length!==1)throw new Error(`Ожидалась одна видимая кнопка «${String(name)}», найдено: ${candidates.length}`);
 const button=candidates[0]!;expect(button).toHaveRole("button");expect(button).toHaveAccessibleName(name);return button;
}
export function findButton(name:string|RegExp,scope:Scope=screen,opts:{enabled?:boolean}={}){return waitFor(()=>getButton(name,scope,opts));}
