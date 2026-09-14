import {
  beginTwoFactor,
  changeEmail,
  changePassword,
  confirmTwoFactor,
  generateRecoveryCodes,
} from "../auth";
import {
  downloadRecoveryCodes,
  setStatus,
  type SettingsContext,
} from "./shared";
import { isValidEmail } from "../validation";

export function mountSecuritySettings(
  root: HTMLElement,
  context: SettingsContext,
): void {
  const emailForm = root.querySelector<HTMLFormElement>(
    "[data-role=email-form]",
  )!;
  const emailStatus = emailForm.querySelector<HTMLElement>(".fk-form-status")!;

  const fillEmailHint = () => {
    const account = context.getAccount();
    const hint = root.querySelector<HTMLElement>("[data-role=current-email]")!;
    if (account) hint.textContent = account.profile.email;
  };

  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context.getAccount()) return;
    const data = new FormData(emailForm);
    const email = String(data.get("email") ?? "").trim();
    const emailInput =
      emailForm.querySelector<HTMLInputElement>("[name=email]")!;
    if (!isValidEmail(email)) {
      emailInput.setAttribute("aria-invalid", "true");
      setStatus(emailStatus, "请输入有效的邮箱地址");
      emailInput.focus();
      return;
    }
    emailInput.removeAttribute("aria-invalid");
    const button =
      emailForm.querySelector<HTMLButtonElement>(".fk-primary-btn")!;
    button.disabled = true;
    try {
      const account = await changeEmail({
        email,
        password: String(data.get("password") ?? ""),
      });
      context.setAccount(account);
      emailForm.reset();
      fillEmailHint();
      setStatus(emailStatus, "邮箱已更新 ✓");
      setTimeout(() => setStatus(emailStatus, ""), 1500);
    } catch (error) {
      setStatus(
        emailStatus,
        error instanceof Error ? error.message : "更新失败",
      );
    } finally {
      button.disabled = false;
    }
  });

  const passwordForm = root.querySelector<HTMLFormElement>(
    "[data-role=password-form]",
  )!;
  const passwordStatus =
    passwordForm.querySelector<HTMLElement>(".fk-form-status")!;

  passwordForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context.getAccount()) return;
    const data = new FormData(passwordForm);
    const next = String(data.get("next") ?? "");
    if (next !== String(data.get("confirm") ?? "")) {
      setStatus(passwordStatus, "两次输入的新密码不一致");
      return;
    }
    const button =
      passwordForm.querySelector<HTMLButtonElement>(".fk-primary-btn")!;
    button.disabled = true;
    try {
      await changePassword({
        current: String(data.get("current") ?? ""),
        next,
      });
      passwordForm.reset();
      setStatus(passwordStatus, "密码已更新 ✓");
      setTimeout(() => setStatus(passwordStatus, ""), 1500);
    } catch (error) {
      setStatus(
        passwordStatus,
        error instanceof Error ? error.message : "更新失败",
      );
    } finally {
      button.disabled = false;
    }
  });

  const tfaStatus = root.querySelector<HTMLElement>("[data-role=tfa-status]")!;
  const tfaOff = root.querySelector<HTMLElement>("[data-role=tfa-off]")!;
  const tfaSetup = root.querySelector<HTMLElement>("[data-role=tfa-setup]")!;
  const tfaManage = root.querySelector<HTMLElement>("[data-role=tfa-manage]")!;

  const renderTfa = () => {
    const account = context.getAccount();
    if (!account) return;
    tfaStatus.textContent = account.twoFactorEnabled
      ? ""
      : "未开启。开启后登录时需要验证器 App 的动态验证码。";
    tfaStatus.hidden = Boolean(account.twoFactorEnabled);
    tfaOff.hidden = Boolean(account.twoFactorEnabled);
    tfaManage.hidden = !account.twoFactorEnabled;
    tfaSetup.hidden = true;
    setStatus(root.querySelector<HTMLElement>("[data-role=tfa-secret]"), "");
  };

  const startTfaSetup = async () => {
    try {
      const { secret } = await beginTwoFactor();
      setStatus(
        root.querySelector<HTMLElement>("[data-role=tfa-secret]"),
        secret,
      );
      tfaStatus.hidden = true;
      tfaOff.hidden = true;
      tfaManage.hidden = true;
      tfaSetup.hidden = false;
      setStatus(
        root.querySelector<HTMLElement>("[data-role=tfa-setup-status]"),
        "",
      );
    } catch (error) {
      tfaStatus.hidden = false;
      tfaStatus.textContent =
        error instanceof Error ? error.message : "初始化失败";
    }
  };

  root
    .querySelector<HTMLButtonElement>("[data-role=tfa-start]")!
    .addEventListener("click", startTfaSetup);

  root
    .querySelector<HTMLButtonElement>("[data-role=tfa-replace]")!
    .addEventListener("click", startTfaSetup);

  root
    .querySelector<HTMLButtonElement>("[data-role=tfa-cancel]")!
    .addEventListener("click", renderTfa);

  root
    .querySelector<HTMLButtonElement>("[data-role=tfa-confirm]")!
    .addEventListener("click", async () => {
      const code = root
        .querySelector<HTMLInputElement>("[data-role=tfa-code]")!
        .value.trim();
      const setupStatus = root.querySelector<HTMLElement>(
        "[data-role=tfa-setup-status]",
      )!;
      try {
        const account = await confirmTwoFactor(code);
        context.setAccount(account);
        renderTfa();
        renderRecovery();
      } catch (error) {
        setStatus(
          setupStatus,
          error instanceof Error ? error.message : "验证失败",
        );
      }
    });

  const recoveryBox = root.querySelector<HTMLElement>(
    "[data-role=recovery-box]",
  )!;
  const recoveryHint = root.querySelector<HTMLElement>(
    "[data-role=recovery-hint]",
  )!;
  const recoveryGenerate = root.querySelector<HTMLButtonElement>(
    "[data-role=recovery-generate]",
  )!;
  const recoverySummary = root.querySelector<HTMLElement>(
    "[data-role=recovery-summary]",
  )!;
  const recoveryReplace = root.querySelector<HTMLButtonElement>(
    "[data-role=recovery-replace]",
  )!;

  const renderRecovery = (showCodes = false) => {
    const account = context.getAccount();
    if (!account) return;
    const recoveryCount = account.recoveryCodeCount;
    recoveryBox.hidden = !showCodes;
    recoveryHint.hidden = account.twoFactorEnabled;
    recoverySummary.hidden = !account.twoFactorEnabled || recoveryCount === 0;
    recoveryGenerate.hidden = !account.twoFactorEnabled || recoveryCount > 0;
    root.querySelector<HTMLElement>("[data-role=recovery-count]")!.textContent =
      `当前已生成 ${recoveryCount} 个恢复密钥`;
  };

  const replaceRecoveryCodes = async () => {
    recoveryGenerate.disabled = true;
    recoveryReplace.disabled = true;
    try {
      const result = await generateRecoveryCodes();
      root
        .querySelector<HTMLElement>("[data-role=recovery-list]")!
        .replaceChildren(
          ...result.codes.map((code) => {
            const item = document.createElement("li");
            item.textContent = code;
            return item;
          }),
        );
      const account = context.getAccount();
      if (account) {
        context.setAccount({
          ...account,
          recoveryCodeCount: result.recoveryCodeCount,
        });
      }
      renderRecovery(true);
    } catch (error) {
      setStatus(
        root.querySelector<HTMLElement>("[data-role=recovery-status]"),
        error instanceof Error ? error.message : "生成失败",
      );
    } finally {
      recoveryGenerate.disabled = false;
      recoveryReplace.disabled = false;
    }
  };

  recoveryGenerate.addEventListener("click", replaceRecoveryCodes);
  recoveryReplace.addEventListener("click", replaceRecoveryCodes);

  root
    .querySelector<HTMLButtonElement>("[data-role=recovery-copy]")!
    .addEventListener("click", async (event) => {
      const codes = [
        ...root.querySelectorAll<HTMLElement>("[data-role=recovery-list] li"),
      ].map((item) => item.textContent ?? "");
      try {
        await navigator.clipboard.writeText(codes.join("\n"));
        const button = event.currentTarget as HTMLButtonElement;
        button.textContent = "已复制 ✓";
        setTimeout(() => {
          button.textContent = "复制全部";
        }, 1500);
      } catch {}
    });

  root
    .querySelector<HTMLButtonElement>("[data-role=recovery-download]")!
    .addEventListener("click", () => {
      const codes = [
        ...root.querySelectorAll<HTMLElement>("[data-role=recovery-list] li"),
      ].map((item) => item.textContent ?? "");
      if (codes.length > 0) downloadRecoveryCodes(codes);
    });

  fillEmailHint();
  renderTfa();
  renderRecovery();
}
