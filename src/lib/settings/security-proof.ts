import { getAccount } from "../accounts/auth";
import { el } from "../ui/dom";

export interface SecurityProof {
  password: string;
  code?: string;
  recoveryCode?: string;
}

export function requestSecurityProof(): Promise<SecurityProof | null> {
  return new Promise((resolve) => {
    const dialog = el("dialog", "security-proof");
    const form = el("form");
    form.method = "dialog";
    const title = el("h3");
    title.textContent = "验证身份";
    const password = el("input");
    password.type = "password";
    password.autocomplete = "current-password";
    password.required = true;
    const passwordLabel = el("label", "field");
    const caption = el("span", "field-label");
    caption.textContent = "当前密码";
    passwordLabel.append(caption, password);
    const code = el("input");
    code.autocomplete = "one-time-code";
    code.maxLength = 20;
    const codeLabel = el("label", "field");
    const codeCaption = el("span", "field-label");
    codeCaption.textContent = "动态验证码或恢复码";
    codeLabel.append(codeCaption, code);
    codeLabel.hidden = !getAccount()?.twoFactorEnabled;
    code.required = !codeLabel.hidden;
    const foot = el("div", "inline-row");
    const cancel = el("button", "ghost-btn");
    cancel.type = "button";
    cancel.textContent = "取消";
    const submit = el("button", "primary-btn");
    submit.type = "submit";
    submit.textContent = "确认";
    let result: SecurityProof | null = null;
    form.addEventListener("submit", () => {
      const value = code.value.trim();
      result = {
        password: password.value,
        ...(/^\d{6}$/.test(value)
          ? { code: value }
          : value
            ? { recoveryCode: value }
            : {}),
      };
    });
    cancel.onclick = () => dialog.close();
    const onSwap = () => dialog.close();
    document.addEventListener("astro:before-swap", onSwap, { once: true });
    dialog.addEventListener(
      "close",
      () => {
        document.removeEventListener("astro:before-swap", onSwap);
        password.value = code.value = "";
        dialog.remove();
        resolve(result);
      },
      { once: true },
    );
    foot.append(cancel, submit);
    form.append(title, passwordLabel, codeLabel, foot);
    dialog.append(form);
    document.body.append(dialog);
    dialog.showModal();
    password.focus();
  });
}
