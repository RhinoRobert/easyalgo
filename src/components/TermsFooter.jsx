// Fine print only: nothing here asks for a click, a tick box or typing before the app works.
import MainSiteLink from "./MainSiteLink";

export default function TermsFooter() {
  return (
    <footer className="terms" id="terms">
      <p className="terms-line">A <MainSiteLink>TestedProfit</MainSiteLink> project.</p>
      <p className="terms-line">
        Beta. Tokens launched here are permanent and nothing on this site is financial, legal or tax advice. Use only amounts you can afford to lose.
      </p>
      <details>
        <summary>Terms and risks</summary>
        <ol>
          <li><strong>Beta software.</strong> This site and the smart contract behind it are in beta. Features can change, the site can be unavailable, and there may be bugs. A contract that has been tested can still contain mistakes.</li>
          <li><strong>Final and public.</strong> Algorand transactions cannot be undone. Tokens created here have no manager, freeze or clawback address, and the launchpad contract cannot be upgraded or paused. Your wallet address and everything you do with it are public on the blockchain.</li>
          <li><strong>What a launch does.</strong> You pay 1 ALGO, swapped into PNET, plus refundable and non-refundable deposits and network fees. The whole token supply and that PNET become liquidity in a Tinyman pool. 80% of the liquidity tokens are burned for good, 10% are held for the launcher to claim, and 10% go to the platform. If a launch cannot finish, cancelling after the delay returns half of the token and PNET to the launcher and the other half to the platform wallet.</li>
          <li><strong>No endorsement.</strong> Tokens are created by third parties. The operator does not create, vet, verify or endorse any token, its name, its creator, its website or its claims, and makes no promise about liquidity, price or value. A token can lose all of its value. Names and logos can imitate other projects: check the asset ID.</li>
          <li><strong>Third parties.</strong> The service depends on the Algorand network, Tinyman, ARC-54, Vestige, Pera Wallet, public Algorand nodes and the hosting and network providers of this site. Any of them can fail or change, and the operator is not responsible for them.</li>
          <li><strong>Your responsibility.</strong> You alone are responsible for the security of your wallet and recovery phrase, and for following the laws and rules that apply to you, including any that cover creating, offering or trading tokens. Do not use this service where it is not allowed for you.</li>
          <li><strong>No warranty or liability.</strong> The service is provided as is and as available, without warranties of any kind. To the fullest extent the law allows, the operator is not liable for any loss or damage arising from its use.</li>
          <li><strong>Privacy.</strong> This site has no accounts, cookies or analytics of its own. Your browser connects to public Algorand nodes, to Pera Wallet and to the providers that host this site, and these see ordinary connection data such as your IP address.</li>
          <li><strong>Changes.</strong> These terms may change. The version shown on this page applies.</li>
        </ol>
      </details>
    </footer>
  );
}
