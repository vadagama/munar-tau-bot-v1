import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { expect, it, vi, afterEach, beforeEach } from "vitest";
import { RegistrationSimulator } from "./registration-simulator";
import { apiFetch } from "../lib/api";
vi.mock("../lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ reply: "Выберите язык: ru / kk" }),
}));
const scrollIntoView = vi.fn();
beforeEach(() => { Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("до включения эмуляции не отправляет шаг", () => {
  render(<RegistrationSimulator active={false} />);
  expect(screen.getByRole("button", { name: "Зарегистрироваться" })).toBeDisabled();
});
it("активная персона исполняет общий сценарий registration и видит ответ", async () => {
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
  await waitFor(() =>
    expect(apiFetch).toHaveBeenCalledWith("/v1/emulation/simulate", {
      method: "POST",
      body: { scenario: "registration", input: "/register" },
    }),
  );
  expect(await screen.findByText("Выберите язык: ru / kk")).toBeInTheDocument();
});

it("показывает кнопки сценария и отправляет их data вместо подписи", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    reply: "Выберите язык",
    buttons: [[{ text: "Қазақша", data: "kk" }, { text: "Русский", data: "ru" }]],
  }).mockResolvedValueOnce({ reply: "Укажите имя" });
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
  fireEvent.click(await screen.findByRole("button", { name: "Қазақша" }));
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "registration", input: "kk" },
  }));
  expect(await screen.findByText("Укажите имя")).toBeInTheDocument();
});
it("не показывает главное меню под ответами, сохраняя кнопки выбора сообщения", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "Выберите язык", buttons: [[{text: "Русский", data: "ru"}]], menu: [[
    { text: "🆕 Новое обращение", data: "/newrequest", scenario: "requests" },
    { text: "❓ Помощь", data: "/help", scenario: "registration" },
  ]] });
  render(<RegistrationSimulator active />);
  fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
  expect(await screen.findByText("Выберите язык")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "🆕 Новое обращение" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "❓ Помощь" })).not.toBeInTheDocument();
  expect(screen.getByRole("log", { name: "Диалог симулятора" })).toContainElement(screen.getByRole("button", { name: "Русский" }));
});
it("прокручивает к каждому новому ответу и переводит фокус на него", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "Первый ответ" }).mockResolvedValueOnce({ reply: "Второй ответ" });
  render(<RegistrationSimulator active />);
  expect(scrollIntoView).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Зарегистрироваться" }));
  const first = await screen.findByRole("article", { name: "Ответ симулятора 1" });
  await waitFor(() => expect(first).toHaveFocus());
  expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "start", inline: "nearest" });
  fireEvent.click(screen.getByRole("button", { name: "Статус регистрации" }));
  const second = await screen.findByRole("article", { name: "Ответ симулятора 2" });
  await waitFor(() => expect(second).toHaveFocus());
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение симулятору" }), { target: { value: "Следующий шаг" } });
  expect(scrollIntoView).toHaveBeenCalledTimes(2);
});

it("показывает кнопки под ответом и продолжает сценарий, выбранный сервером по /register", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({
    scenario_id: "registration", reply: "Выберите язык",
    buttons: [[{ text: "Русский", data: "ru" }]],
  }).mockResolvedValueOnce({ scenario_id: "registration", reply: "Укажите имя" });
  render(<RegistrationSimulator active />);
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Сценарий симулятора" }));
  fireEvent.click(screen.getByText("Обращения", { selector: ".ant-select-item-option-content" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение симулятору" }), { target: { value: "/register" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить шаг" }));
  const button = await screen.findByRole("button", { name: "Русский" });
  expect(screen.getByRole("log", { name: "Диалог симулятора" })).toContainElement(button);
  fireEvent.click(button);
  await waitFor(() => expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate", {
    method: "POST", body: { scenario: "registration", input: "ru" },
  }));
});

it("показывает форматирование ответа вместо тегов, ввод пользователя оставляет текстом", async () => {
  vi.mocked(apiFetch).mockResolvedValueOnce({ reply: "<b>З-26-00011</b> — зарегистрировано.\nПервый ответ: 19.10.2026 13:00." });
  render(<RegistrationSimulator active />);
  fireEvent.change(screen.getByRole("textbox", { name: "Сообщение симулятору" }), { target: { value: "<b>Мой текст</b>" } });
  fireEvent.click(screen.getByRole("button", { name: "Отправить шаг" }));
  expect((await screen.findByText("З-26-00011")).tagName).toBe("STRONG");
  expect(screen.getByText("Вы: <b>Мой текст</b>")).toBeInTheDocument();
});

it("открывает номер обращения своей служебной ссылкой в текущем симуляторе",async()=>{
 const id='00000000-0000-4000-8000-000000000001';
 vi.mocked(apiFetch).mockResolvedValueOnce({reply:`<a href="https://t.me/munar_tau_worker_bot?start=sreq_${id}">З-26-1</a>`}).mockResolvedValueOnce({reply:'Карточка обращения'});
 render(<RegistrationSimulator active />);
 fireEvent.click(screen.getByRole('button',{name:'Зарегистрироваться'}));
 fireEvent.click(await screen.findByRole('link',{name:'З-26-1'}));
 await waitFor(()=>expect(apiFetch).toHaveBeenLastCalledWith('/v1/emulation/simulate',{method:'POST',body:{scenario:'staff-requests',input:`/start sreq_${id}`}}));
 expect(await screen.findByText('Карточка обращения')).toBeInTheDocument();
});

it("показывает кнопки регистрации только в сценарии регистрации, отменяя диалог в любом сценарии",async()=>{
 render(<RegistrationSimulator active />);
 fireEvent.mouseDown(screen.getByRole("combobox",{name:"Сценарий симулятора"}));
 fireEvent.click(screen.getByText("Обращения",{selector:".ant-select-item-option-content"}));
 expect(screen.queryByRole("button",{name:"Зарегистрироваться"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Статус регистрации"})).not.toBeInTheDocument();
 expect(screen.queryByRole("button",{name:"Мои помещения"})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"Отменить"}));
 await waitFor(()=>expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate",{
   method:"POST", body:{scenario:"requests",input:"/cancel"},
 }));
});

it("ссылка дома выбирает его в сценарии регистрации симулятора", async () => {
 const payload='house_00000000-0000-4000-8000-000000000001_123456abcdef';
 vi.mocked(apiFetch).mockResolvedValueOnce({reply:`<b>Очередь 1</b>\n<a href="https://t.me/munar_tau_user_bot?start=${payload}">102/1</a>`}).mockResolvedValueOnce({reply:'Тип помещения'});
 render(<RegistrationSimulator active />);
 fireEvent.click(screen.getByRole('button',{name:'Зарегистрироваться'}));
 fireEvent.click(await screen.findByRole('link',{name:'102/1'}));
 await waitFor(()=>expect(apiFetch).toHaveBeenLastCalledWith('/v1/emulation/simulate',{method:'POST',body:{scenario:'registration',input:`/start ${payload}`}}));
 expect(await screen.findByText('Тип помещения')).toBeInTheDocument();
});
it("переходит в опросы и отправляет точную кнопку личного ответа",async()=>{
  vi.mocked(apiFetch).mockResolvedValueOnce({scenario_id:"polls",reply:"Информационный опрос",buttons:[[{text:"Суббота",data:"/pc nonce 0"}]]}).mockResolvedValueOnce({scenario_id:"polls",reply:"Ваш ответ сохранён"});
  render(<RegistrationSimulator active/>);
  fireEvent.change(screen.getByRole("textbox",{name:"Сообщение симулятору"}),{target:{value:"/polls"}});
  fireEvent.click(screen.getByRole("button",{name:"Отправить шаг"}));
  fireEvent.click(await screen.findByRole("button",{name:"Суббота"}));
  await waitFor(()=>expect(apiFetch).toHaveBeenLastCalledWith("/v1/emulation/simulate",{method:"POST",body:{scenario:"polls",input:"/pc nonce 0"}}));
  expect(await screen.findByText("Ваш ответ сохранён")).toBeInTheDocument();
});
