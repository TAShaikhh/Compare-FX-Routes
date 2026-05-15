/**
 * Root page — server component.
 *
 * Loads the supported currency list at request time (synchronous, no
 * network call) and passes it to the client-side `FxRoutingTool` component.
 * This keeps the currency list out of the client bundle and allows the
 * component to render the dropdown immediately on hydration.
 */

import { FxRoutingTool } from "@/components/fx-routing-tool";
import { getSupportedCurrencies } from "@/lib/currencies";

export default function Home() {
  return <FxRoutingTool currencies={getSupportedCurrencies()} />;
}
