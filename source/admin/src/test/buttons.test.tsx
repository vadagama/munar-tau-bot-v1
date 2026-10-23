import { cleanup,render } from "@testing-library/react";
import { afterEach,expect,it } from "vitest";
import { getButton,findButton } from "./buttons";
afterEach(cleanup);
it("скрытый дубль не заменяет видимую кнопку; disabled остаётся проверяемым",async()=>{
 render(<><div style={{display:"none"}}><button>Сохранить</button></div><button disabled><span>Сохранить</span></button></>);
 expect(await findButton("Сохранить")).toBeDisabled();
});
it("aria-hidden и неверное доступное имя не позволяют нажать найденный текст",()=>{
 render(<><button aria-hidden="true">Скрытая</button><button aria-label="Другое имя">Подтвердить</button></>);
 expect(()=>getButton("Скрытая")).toThrow(/найдено: 0/);expect(()=>getButton("Подтвердить")).toThrow();
});
it("видимые дубли остаются неоднозначными",()=>{
 render(<><button>Отмена</button><button>Отмена</button></>);expect(()=>getButton("Отмена")).toThrow(/найдено: 2/);
});
it("подмена эффективной роли кнопки не проходит проверку",()=>{
 render(<button role="link">Сохранить</button>);expect(()=>getButton("Сохранить")).toThrow();
});
