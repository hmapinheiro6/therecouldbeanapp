import { PixelArt } from "../components/PixelArt";
import { Link } from "react-router-dom";
export function About() {
  return (
    <div className="page prose">
      <h1 className="page-title">Find software that already exists.</h1>
      <p className="lead">
        There Could Be An App helps you find the software that already solves
        your very original problem.
      </p>
      <h2>The joke is optional. The evidence isn’t.</h2>
      <p>
        Describe an idea in everyday language. We look through a catalog of real
        products, identify the capabilities you requested, and compare them with
        what each product’s official sources actually support.
      </p>
      <p>
        Strong matches cover all recognized requested capabilities. Partial
        matches cover some. Related products share relevant wording. Qualifiers
        we cannot verify, such as offline use or a particular industry, prevent
        a strong match. These labels describe our evidence, not a guarantee of
        fit.
      </p>
      <h2>How search works</h2>
      <p>
        Search uses full-text indexing, synonyms, and deterministic ranking. No
        AI inference, invented percentages, or “87 competitors detected”
        theater. We don’t test every product hands-on, and our catalog doesn’t
        cover the whole internet.
      </p>
      <h2>Where new apps come from</h2>
      <p>
        The initial catalog was seeded with 45 familiar products to test search.
        Discovery runs daily at 04:17 UTC, collecting recent Show HN launches
        and new GitHub repositories with official product websites. Founders can
        also <Link to="/submit">submit an app</Link>. We do not require
        popularity or GitHub stars.
      </p>
      <p>
        A source mention is a lead. Before publication, we check the official
        website, confirm the product identity, and save explicit capability
        evidence. Blocked sites, unclear identities, and unsupported claims stay
        out of search for review. “Recently added” means first added to this
        catalog; it does not mean a verified launch date.
      </p>
      <p>
        Coverage is still small. These sources miss products that are not
        announced there, including many closed-source SaaS products. We will
        need additional permitted launch feeds and founder submissions to
        broaden it.
      </p>
      <h2>Someone else built it. Now what?</h2>
      <p>
        Use it. Study it. Build something better. Finding competition is useful
        information, not a cease-and-desist.
      </p>
      <Link className="button primary" to="/">
        Test your originality ↗
      </Link>
    </div>
  );
}
export function Privacy() {
  return (
    <div className="page prose">
      <h1 className="page-title">Your ideas are yours.</h1>
      <p className="updated-date">Last updated 15 November 2026</p>
      <p className="lead">
        This policy describes the application as implemented. No advertising
        trackers or analytics scripts are installed.
      </p>
      <h2>Search</h2>
      <p>
        We process the words you enter to find relevant products. The
        application does not save raw searches, build personal profiles, or sell
        ideas. Searches appear in the URL so you can share them. Browser history
        and hosting providers may retain request information; avoid entering
        confidential information.
      </p>
      <h2>Submissions</h2>
      <p>
        We store the product name, website, description, category, submission
        status, and an optional contact email. We use this information to verify
        and moderate the product. Contact emails and moderation notes are never
        included in public APIs or catalog snapshots. An email is optional and
        used only for the submission.
      </p>
      <p>
        Contact emails are removed after 30 days by the scheduled ingestion
        cleanup. Closed submissions are eligible for deletion after 30 days;
        linked review records may be retained without their contact email. If
        the scheduler stops, cleanup is delayed until the next successful run.
        Published product facts and their evidence remain in the catalog.
      </p>
      <h2>Spam protection and hosting</h2>
      <p>
        Cloudflare hosts the application and provides Turnstile spam protection.
        Turnstile processes browser and network information under{" "}
        <a
          href="https://www.cloudflare.com/privacypolicy/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Cloudflare’s privacy policy
        </a>
        . Our submission limiter stores a daily salted hash derived from the IP
        address, not the raw address. These identifiers are removed after two
        days by scheduled cleanup. Cloudflare may process IP addresses in its
        operational and security logs.
      </p>
      <h2>External links</h2>
      <p>
        Product links and optional web search links take you to other websites
        with their own policies. We fetch product metadata from public official
        websites during scheduled discovery, separately from visitor searches.
      </p>
      <h2>Contact and rights</h2>
      <p>
        Contact{" "}
        <a href="mailto:support@therecouldbeanapp.com">
          support@therecouldbeanapp.com
        </a>{" "}
        for privacy requests, including access, correction, or deletion of
        submission information. Include enough information for us to identify
        the submission; never send passwords or sensitive customer data.
      </p>
    </div>
  );
}
export function Terms() {
  return (
    <div className="page prose">
      <h1 className="page-title">
        The small print.
        <br />
        Normal-sized.
      </h1>
      <p className="lead">
        Use the catalog to research software. Keep your own judgment switched
        on.
      </p>
      <h2>What this service provides</h2>
      <p>
        Search results are informational comparisons drawn from a limited
        catalog and documented capabilities. They are not exhaustive market
        research, patent clearance, endorsements, legal advice, or guarantees of
        availability, security, pricing, or fitness for a purpose. Features
        change after verification.
      </p>
      <h2>Your submissions</h2>
      <p>
        Submit truthful, public product information that you have the right to
        share. Do not include private customer data, credentials, or
        confidential material. You allow us to verify the information and
        publish a factual product listing. Submitting does not guarantee
        publication. We may edit, reject, or remove listings.
      </p>
      <h2>Reasonable use</h2>
      <p>
        Do not abuse the service, bypass anti-spam controls, attack
        infrastructure, or misrepresent a product. Automated requests must
        respect access controls and resource limits. Access may be limited when
        free infrastructure quotas are reached.
      </p>
      <h2>Third-party products</h2>
      <p>
        Product names belong to their respective owners. Linked providers are
        independent and governed by their own terms. Verify important
        requirements directly with the provider.
      </p>
      <h2>Availability and corrections</h2>
      <p>
        The service is provided as available, to the extent permitted by
        applicable law. Nothing in these terms excludes rights that cannot
        legally be excluded. Questions about this service can be sent to{" "}
        <a href="mailto:support@therecouldbeanapp.com">
          support@therecouldbeanapp.com
        </a>
        . Applicable mandatory consumer and privacy protections continue to
        apply.
      </p>
    </div>
  );
}
export function NotFound() {
  return (
    <div className="page empty-state not-found">
      <PixelArt kind="disk" />
      <h1 className="page-title">
        There isn’t a page
        <br />
        for that.
      </h1>
      <p>Finally. Something nobody built.</p>
      <Link className="button primary" to="/">
        Back to familiar territory ↗
      </Link>
    </div>
  );
}
