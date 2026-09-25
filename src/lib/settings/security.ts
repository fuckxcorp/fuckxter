import {
  beginTwoFactor,
  changeEmail,
  changePassword,
  confirmTwoFactor,
  deleteAccount,
  generateRecoveryCodes,
  setDmPolicy,
} from "../accounts/auth";
import {
  downloadRecoveryCodes,
  setStatus,
  type SettingsContext,
} from "./shared";
import { isValidEmail } from "../core/validation";
import type { DmPolicy } from "../core/types";

export function mountSecuritySettings(
  root: HTMLElement,
  context: SettingsContext,
): void {
  const securityPane = root.querySelector<HTMLElement>(
    "[data-settings-pane=security]",
  )!;
  const formGroups = [
    ...securityPane.querySelectorAll<HTMLElement>(".security-forms"),
  ];
  if (formGroups.length > 0) {
    const cards = formGroups.flatMap((group) => [
      ...group.querySelectorAll<HTMLElement>(":scope > .fieldset"),
    ]);
    const masonry = document.createElement("div");
    masonry.className = "security-masonry";
    const card = (role: string) =>
      cards.find((item) => item.matches(`[data-role=${role}]`));
    const ordered = [
      card("dm-policy-form"),
      card("email-form"),
      card("password-form"),
      card("recovery-form"),
      card("delete-account"),
      card("tfa-form"),
    ];
    ordered.forEach((item) => item && masonry.append(item));
    securityPane.insertBefore(masonry, formGroups[0]);
    formGroups.forEach((group) => group.remove());
  }

  const emailForm = root.querySelector<HTMLFormElement>(
    "[data-role=email-form]",
  )!;
  const emailStatus = emailForm.querySelector<HTMLElement>(".form-status")!;

  // 私信权限：改完立刻生效，不用点保存
  const dmForm = root.querySelector<HTMLElement>("[data-role=dm-policy-form]")!;
  const dmSelect = dmForm.querySelector<HTMLSelectElement>(
    "[data-role=dm-policy]",
  )!;
  const dmStatus = dmForm.querySelector<HTMLElement>(
    "[data-role=dm-policy-status]",
  )!;

  const fillDmPolicy = () => {
    dmSelect.value = context.getAccount()?.dmPolicy ?? "everyone";
  };

  dmSelect.addEventListener("change", async () => {
    if (!context.getAccount()) return;
    const next = dmSelect.value as DmPolicy;
    dmSelect.disabled = true;
    try {
      const account = await setDmPolicy(next);
      context.setAccount(account);
      setStatus(dmStatus, "私信权限已更新 ✓");
      setTimeout(() => setStatus(dmStatus, ""), 1500);
    } catch (error) {
      fillDmPolicy();
      setStatus(dmStatus, error instanceof Error ? error.message : "更新失败");
    } finally {
      dmSelect.disabled = false;
    }
  });

  fillDmPolicy();

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
    const button = emailForm.querySelector<HTMLButtonElement>(".primary-btn")!;
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
    passwordForm.querySelector<HTMLElement>(".form-status")!;

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
      passwordForm.querySelector<HTMLButtonElement>(".primary-btn")!;
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
    const usedUp = account.twoFactorEnabled && recoveryCount === 0;
    recoveryBox.hidden = !showCodes;
    recoveryHint.hidden = account.twoFactorEnabled;
    recoverySummary.hidden = !account.twoFactorEnabled;
    recoverySummary.classList.toggle("is-warning", usedUp);
    recoveryReplace.hidden = recoveryCount === 0;
    recoveryGenerate.hidden = false;
    recoveryGenerate.disabled = !account.twoFactorEnabled || recoveryCount > 0;
    root.querySelector<HTMLElement>("[data-role=recovery-count]")!.textContent =
      usedUp
        ? "恢复密钥已用完，请立即重新生成"
        : `当前已生成 ${recoveryCount} 个恢复密钥`;
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
      const account = context.getAccount();
      recoveryGenerate.disabled =
        !account?.twoFactorEnabled || account.recoveryCodeCount > 0;
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

  const deleteButton = root.querySelector<HTMLButtonElement>(
    "[data-role=account-delete]",
  );
  const deleteStatus = root.querySelector<HTMLElement>(
    "[data-role=account-delete-status]",
  );
  deleteButton?.addEventListener("click", async () => {
    if (
      !confirm(
        "确定要删除账号吗？3 天内登录回来可以取消，超过 3 天账号和数据会被永久删除。",
      )
    ) {
      return;
    }
    deleteButton.disabled = true;
    setStatus(deleteStatus, "处理中…");
    try {
      await deleteAccount();
      location.href = "/";
    } catch (error) {
      deleteButton.disabled = false;
      setStatus(
        deleteStatus,
        error instanceof Error ? error.message : "删除失败，请稍后重试。",
      );
    }
  });

  fillEmailHint();
  renderTfa();
  renderRecovery();
}
