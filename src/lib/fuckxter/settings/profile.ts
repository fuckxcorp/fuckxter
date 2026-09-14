import { removeAvatar, uploadAvatar } from "../api";
import { getAccount, hydrateSession, updateProfile } from "../auth";
import { avatarGradient } from "../dom";
import { ApiError, apiEndpoint } from "../http";
import { isValidBirthday, isValidUsername } from "../validation";
import { setStatus, type SettingsContext } from "./shared";

const GENDER_PRESETS = ["男", "女", "跨性别男", "跨性别女"];

export function mountProfileSettings(
  root: HTMLElement,
  context: SettingsContext,
): void {
  const profileForm = root.querySelector<HTMLFormElement>(
    "[data-role=profile-form]",
  )!;
  const bioInput =
    profileForm.querySelector<HTMLTextAreaElement>("[name=bio]")!;
  const bioCount = root.querySelector<HTMLElement>("[data-role=bio-count]")!;
  const profileStatus =
    profileForm.querySelector<HTMLElement>(".fk-form-status")!;
  const avatar = root.querySelector<HTMLElement>("[data-role=profile-avatar]")!;
  const avatarUpload = root.querySelector<HTMLButtonElement>(
    "[data-role=avatar-upload]",
  )!;
  const avatarRemove = root.querySelector<HTMLButtonElement>(
    "[data-role=avatar-remove]",
  )!;
  const avatarInput = root.querySelector<HTMLInputElement>(
    "[data-role=avatar-input]",
  )!;
  const avatarProgress = root.querySelector<HTMLProgressElement>(
    "[data-role=avatar-progress]",
  )!;
  const cropDialog = root.querySelector<HTMLDialogElement>(
    "[data-role=avatar-crop-dialog]",
  )!;
  const cropCanvas = root.querySelector<HTMLCanvasElement>(
    "[data-role=avatar-crop-canvas]",
  )!;
  const cropZoom = root.querySelector<HTMLInputElement>(
    "[data-role=avatar-crop-zoom]",
  )!;
  const cropCancel = root.querySelector<HTMLButtonElement>(
    "[data-role=avatar-crop-cancel]",
  )!;
  const cropConfirm = root.querySelector<HTMLButtonElement>(
    "[data-role=avatar-crop-confirm]",
  )!;
  const genderSelect =
    profileForm.querySelector<HTMLSelectElement>("[name=gender]")!;
  const handleInput =
    profileForm.querySelector<HTMLInputElement>("[name=handle]")!;
  const birthdayInput =
    profileForm.querySelector<HTMLInputElement>("[name=birthday]")!;
  const genderCustomInput = profileForm.querySelector<HTMLInputElement>(
    "[name=genderCustom]",
  )!;
  const cropContext = cropCanvas.getContext("2d")!;
  const cropSize = cropCanvas.width;
  let cropImage: HTMLImageElement | null = null;
  let cropFile: File | null = null;
  let cropObjectUrl: string | null = null;
  let cropScale = 1;
  let cropZoomValue = 1;
  let cropOffsetX = 0;
  let cropOffsetY = 0;
  let dragStart: { x: number; y: number } | null = null;

  const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

  const drawCrop = () => {
    if (!cropImage) return;
    cropContext.clearRect(0, 0, cropSize, cropSize);
    const scale = cropScale * cropZoomValue;
    const width = cropImage.naturalWidth * scale;
    const height = cropImage.naturalHeight * scale;
    const maxX = Math.max(0, (width - cropSize) / 2);
    const maxY = Math.max(0, (height - cropSize) / 2);
    cropOffsetX = clamp(cropOffsetX, -maxX, maxX);
    cropOffsetY = clamp(cropOffsetY, -maxY, maxY);
    cropContext.drawImage(
      cropImage,
      (cropSize - width) / 2 + cropOffsetX,
      (cropSize - height) / 2 + cropOffsetY,
      width,
      height,
    );
  };

  const closeCrop = () => {
    if (cropDialog.open) cropDialog.close();
    cropImage = null;
    cropFile = null;
    if (cropObjectUrl) URL.revokeObjectURL(cropObjectUrl);
    cropObjectUrl = null;
    cropZoom.value = "1";
    avatarInput.value = "";
  };

  const cropToFile = (): Promise<File> =>
    new Promise((resolve, reject) => {
      if (!cropImage) {
        reject(new Error("没有可裁切的图片。"));
        return;
      }
      const output = document.createElement("canvas");
      output.width = 512;
      output.height = 512;
      const context = output.getContext("2d");
      if (!context) {
        reject(new Error("浏览器不支持图片裁切。"));
        return;
      }
      const scale = cropScale * cropZoomValue;
      const sourceSize = cropSize / scale;
      const sourceX =
        (cropImage.naturalWidth - sourceSize) / 2 - cropOffsetX / scale;
      const sourceY =
        (cropImage.naturalHeight - sourceSize) / 2 - cropOffsetY / scale;
      context.drawImage(
        cropImage,
        sourceX,
        sourceY,
        sourceSize,
        sourceSize,
        0,
        0,
        output.width,
        output.height,
      );
      output.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error("图片处理失败。"));
            return;
          }
          resolve(
            new File([blob], "avatar.png", {
              type: "image/png",
            }),
          );
        },
        "image/png",
        0.95,
      );
    });

  const avatarErrorMessage = (error: unknown): string => {
    if (!(error instanceof ApiError)) return "头像操作失败，请稍后重试。";
    const messages: Record<string, string> = {
      MEDIA_TOO_LARGE: "图片不能超过 10 MB。",
      UNSUPPORTED_MEDIA: "仅支持 JPEG、PNG、GIF、WebP 和 AVIF 图片。",
      TIMEOUT: "请求超时，请检查网络后重试。",
      NETWORK: "网络连接失败，请稍后重试。",
      UNAUTHORIZED: "登录状态已失效，请重新登录。",
    };
    return (error.code && messages[error.code]) || "头像操作失败，请稍后重试。";
  };

  const syncGenderField = (gender: string) => {
    if (GENDER_PRESETS.includes(gender) || !gender) {
      genderSelect.value = gender;
    } else {
      genderSelect.value = "自定义";
      genderCustomInput.value = gender;
    }
    genderCustomInput.disabled = genderSelect.value !== "自定义";
  };

  const fillProfileForm = () => {
    const account = context.getAccount();
    if (!account) return;
    profileForm.querySelector<HTMLInputElement>("[name=name]")!.value =
      account.profile.name;
    profileForm.querySelector<HTMLInputElement>("[name=handle]")!.value =
      account.profile.handle;
    bioInput.value = account.profile.bio;
    bioCount.textContent = `${[...account.profile.bio].length} / 200`;
    syncGenderField(account.profile.gender);
    profileForm.querySelector<HTMLInputElement>("[name=region]")!.value =
      account.profile.region;
    profileForm.querySelector<HTMLInputElement>("[name=birthday]")!.value =
      account.profile.birthday;
    setStatus(profileStatus, "");
    avatar.setAttribute("style", avatarGradient(account.profile.handle));
    avatarRemove.hidden = !account.avatarUrl;
    const image = document.createElement("img");
    image.className = "fk-profile-avatar-image";
    image.src = account.avatarUrl
      ? account.avatarUrl.startsWith("/")
        ? apiEndpoint(account.avatarUrl)
        : account.avatarUrl
      : "/user.webp";
    image.alt = account.profile.name;
    avatar.replaceChildren(image);
  };

  const refreshAccount = async () => {
    await hydrateSession(true);
    const account = getAccount();
    if (!account) return;
    context.setAccount(account);
    fillProfileForm();
  };

  avatarUpload.addEventListener("click", () => avatarInput.click());
  avatarInput.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStatus(profileStatus, "图片不能超过 10 MB。");
      avatarInput.value = "";
      return;
    }
    try {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.src = objectUrl;
      await image.decode();
      cropImage = image;
      cropFile = file;
      cropObjectUrl = objectUrl;
      cropScale = Math.max(
        cropSize / image.naturalWidth,
        cropSize / image.naturalHeight,
      );
      cropZoomValue = 1;
      cropOffsetX = 0;
      cropOffsetY = 0;
      cropZoom.value = "1";
      drawCrop();
      if (cropDialog.open) cropDialog.close();
      cropDialog.showModal();
      setStatus(profileStatus, "");
    } catch (error) {
      setStatus(profileStatus, avatarErrorMessage(error));
      avatarInput.value = "";
    }
  });

  cropCanvas.addEventListener("pointerdown", (event) => {
    dragStart = { x: event.clientX, y: event.clientY };
    cropCanvas.setPointerCapture(event.pointerId);
  });
  cropCanvas.addEventListener("pointermove", (event) => {
    if (!dragStart) return;
    const rect = cropCanvas.getBoundingClientRect();
    const ratio = cropSize / rect.width;
    cropOffsetX += (event.clientX - dragStart.x) * ratio;
    cropOffsetY += (event.clientY - dragStart.y) * ratio;
    dragStart = { x: event.clientX, y: event.clientY };
    drawCrop();
  });
  cropCanvas.addEventListener("pointerup", () => {
    dragStart = null;
  });
  cropCanvas.addEventListener("pointercancel", () => {
    dragStart = null;
  });
  cropZoom.addEventListener("input", () => {
    cropZoomValue = Number(cropZoom.value);
    drawCrop();
  });
  cropCancel.addEventListener("click", closeCrop);
  cropDialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeCrop();
  });
  cropConfirm.addEventListener("click", async () => {
    if (!cropFile) return;
    cropConfirm.disabled = true;
    avatarUpload.disabled = true;
    avatarProgress.hidden = false;
    avatarProgress.value = 0;
    setStatus(profileStatus, "正在处理图片…");
    try {
      const croppedFile = await cropToFile();
      closeCrop();
      setStatus(profileStatus, "上传中 0%");
      await uploadAvatar(croppedFile, (percent) => {
        avatarProgress.value = percent;
        setStatus(profileStatus, `上传中 ${percent}%`);
      });
      await refreshAccount();
      avatarProgress.value = 100;
      setStatus(profileStatus, "头像已更新");
    } catch (error) {
      setStatus(profileStatus, avatarErrorMessage(error));
    } finally {
      avatarProgress.hidden = true;
      cropConfirm.disabled = false;
      avatarUpload.disabled = false;
    }
  });
  avatarRemove.addEventListener("click", async () => {
    avatarRemove.disabled = true;
    try {
      await removeAvatar();
      await refreshAccount();
      setStatus(profileStatus, "头像已删除");
    } catch (error) {
      setStatus(profileStatus, avatarErrorMessage(error));
    } finally {
      avatarRemove.disabled = false;
    }
  });

  genderSelect.addEventListener("change", () => {
    genderCustomInput.disabled = genderSelect.value !== "自定义";
    if (!genderCustomInput.disabled) genderCustomInput.focus();
    else genderCustomInput.value = "";
  });

  bioInput.addEventListener("input", () => {
    bioCount.textContent = `${[...bioInput.value].length} / 200`;
  });

  profileForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!context.getAccount()) return;
    const data = new FormData(profileForm);
    const handle = String(data.get("handle") ?? "")
      .trim()
      .normalize("NFKC");
    if (!isValidUsername(handle)) {
      handleInput.setAttribute("aria-invalid", "true");
      setStatus(
        profileStatus,
        "Username must be 2-32 Unicode letters, numbers, combining marks, underscores, or hyphens",
      );
      handleInput.focus();
      return;
    }
    handleInput.removeAttribute("aria-invalid");
    const birthday = String(data.get("birthday") ?? "").trim();
    if (!isValidBirthday(birthday)) {
      birthdayInput.setAttribute("aria-invalid", "true");
      setStatus(profileStatus, "生日必须在 1700-01-01 到今天之间");
      birthdayInput.focus();
      return;
    }
    birthdayInput.removeAttribute("aria-invalid");
    const gender =
      genderSelect.value === "自定义"
        ? String(data.get("genderCustom") ?? "").trim() || "自定义"
        : genderSelect.value;
    const button =
      profileForm.querySelector<HTMLButtonElement>(".fk-primary-btn")!;
    button.disabled = true;
    try {
      const account = await updateProfile({
        handle,
        name: String(data.get("name") ?? ""),
        bio: String(data.get("bio") ?? ""),
        region: String(data.get("region") ?? ""),
        gender,
        birthday,
      });
      context.setAccount(account);
      fillProfileForm();
      setStatus(profileStatus, "已保存 ✓");
      setTimeout(() => setStatus(profileStatus, ""), 1500);
    } catch (error) {
      setStatus(
        profileStatus,
        error instanceof Error ? error.message : "保存失败",
      );
    } finally {
      button.disabled = false;
    }
  });

  fillProfileForm();
  birthdayInput.max = new Date().toISOString().slice(0, 10);
}
