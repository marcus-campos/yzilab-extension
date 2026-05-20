// Registra o módulo Petlove no module-registry compartilhado.
import * as registry from "../../lib/module-registry.js";
import { mountInboxTab } from "./inbox-tab.js";
import { mountResultPushTab } from "./result-push-tab.js";

registry.register({
  id: "petlove",
  label: "Plano de saúde",
  tabs: [
    { id: "inbox", label: "Inbox", mount: mountInboxTab },
    { id: "push", label: "Sincronizar", mount: mountResultPushTab },
  ],
});
