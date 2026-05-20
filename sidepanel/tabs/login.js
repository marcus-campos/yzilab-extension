import { MSG, send } from "../../lib/messages.js";
import { el, clear, toast } from "../../ui/components.js";

export function mountLogin(container, { onLogin }) {
  clear(container);
  const emailInput = el("input", { type: "email", placeholder: "email@exemplo.com", autocomplete: "username" });
  const passwordInput = el("input", { type: "password", placeholder: "••••••", autocomplete: "current-password" });
  const submit = el("button", { class: "primary" }, "Entrar");
  const status = el("div", { class: "small muted" }, "");

  async function doLogin() {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      toast("Informe email e senha", { type: "error" });
      return;
    }
    submit.disabled = true;
    status.textContent = "autenticando…";
    try {
      await send(MSG.YZILAB_LOGIN, { email, password });
      toast("Login efetuado", { type: "success" });
      onLogin && onLogin();
    } catch (err) {
      status.textContent = "";
      toast(`Falha: ${err.message}`, { type: "error", duration: 5000 });
    } finally {
      submit.disabled = false;
    }
  }

  submit.addEventListener("click", doLogin);
  passwordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doLogin();
  });

  container.appendChild(
    el("div", { class: "field" }, [el("label", {}, "Email"), emailInput])
  );
  container.appendChild(
    el("div", { class: "field" }, [el("label", {}, "Senha"), passwordInput])
  );
  container.appendChild(el("div", { class: "row" }, [submit]));
  container.appendChild(status);
  container.appendChild(
    el(
      "p",
      { class: "small muted", style: { marginTop: "16px" } },
      "Use suas credenciais da Animalex. O token fica salvo localmente nesta extensão e é renovado automaticamente."
    )
  );
}
