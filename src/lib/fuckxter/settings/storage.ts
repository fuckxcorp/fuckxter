import {
  deleteS3Config,
  getS3Configs,
  saveS3Config,
  testS3Connection,
  type S3Config,
} from "../auth";
import { setStatus } from "./shared";

export function mountStorageSettings(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-role=s3-form]")!;
  const status = form.querySelector<HTMLElement>(".fk-form-status")!;
  const select = root.querySelector<HTMLSelectElement>(
    "[data-role=s3-config-select]",
  )!;
  const addButton =
    root.querySelector<HTMLButtonElement>("[data-role=s3-new]")!;
  const deleteButton = root.querySelector<HTMLButtonElement>(
    "[data-role=s3-delete]",
  )!;
  const testButton = root.querySelector<HTMLButtonElement>(
    "[data-role=s3-test]",
  )!;
  const saveButton = form.querySelector<HTMLButtonElement>(".fk-primary-btn")!;
  let configs: S3Config[] = [];
  let selectedId: string | null = null;

  const configFromForm = (): S3Config => {
    const data = new FormData(form);
    return {
      id: selectedId ?? undefined,
      name: String(data.get("name") ?? "").trim(),
      endpoint: String(data.get("endpoint") ?? "").trim(),
      region: String(data.get("region") ?? "").trim(),
      bucket: String(data.get("bucket") ?? "").trim(),
      accessKeyId: String(data.get("accessKeyId") ?? "").trim(),
      secretAccessKey: String(data.get("secretAccessKey") ?? ""),
      pathStyle: data.get("pathStyle") === "on",
      isDefault: data.get("isDefault") === "on",
    };
  };

  const fillForm = (config: S3Config | null) => {
    form.reset();
    selectedId = config?.id ?? null;
    for (const [key, value] of Object.entries(config ?? {})) {
      const field = form.querySelector<HTMLInputElement>(`[name=${key}]`);
      if (!field) continue;
      if (field.type === "checkbox") field.checked = Boolean(value);
      else field.value = String(value);
    }
    deleteButton.disabled = !selectedId;
    select.value = selectedId ?? "";
    if (!selectedId) {
      const defaultField =
        form.querySelector<HTMLInputElement>("[name=isDefault]")!;
      defaultField.checked = configs.length === 0;
    }
    setStatus(status, "");
  };

  const refresh = async (preferredId?: string) => {
    const result = await getS3Configs();
    configs = result.configs;
    select.replaceChildren(
      ...configs.map((config) => {
        const option = document.createElement("option");
        option.value = config.id!;
        option.textContent =
          config.name || config.bucket || config.endpoint || "S3";
        return option;
      }),
    );
    const targetId =
      preferredId ??
      (selectedId && configs.some((config) => config.id === selectedId)
        ? selectedId
        : (result.defaultId ?? configs[0]?.id));
    fillForm(configs.find((config) => config.id === targetId) ?? null);
  };

  select.addEventListener("change", () => {
    fillForm(configs.find((config) => config.id === select.value) ?? null);
  });

  addButton.addEventListener("click", () => fillForm(null));

  deleteButton.addEventListener("click", async () => {
    if (!selectedId) return;
    deleteButton.disabled = true;
    try {
      await deleteS3Config(selectedId);
      selectedId = null;
      await refresh();
      setStatus(status, "已删除");
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "删除失败");
    } finally {
      deleteButton.disabled = false;
    }
  });

  testButton.addEventListener("click", async () => {
    testButton.disabled = true;
    setStatus(status, "测试中…");
    try {
      setStatus(status, await testS3Connection(configFromForm()));
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "连接失败");
    } finally {
      testButton.disabled = false;
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    saveButton.disabled = true;
    try {
      const saved = await saveS3Config(configFromForm());
      selectedId = saved.id ?? null;
      await refresh(selectedId ?? undefined);
      setStatus(status, "已保存 ✓");
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "保存失败");
    } finally {
      saveButton.disabled = false;
    }
  });

  void refresh().catch((error: unknown) => {
    setStatus(status, error instanceof Error ? error.message : "加载失败");
  });
}
