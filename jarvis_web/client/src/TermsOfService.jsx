import "./PrivacyPolicy.css";

export default function TermsOfService() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a className="privacy-brand" href="/" aria-label="COREX home">
          <span className="privacy-logo" aria-hidden="true">J</span>
          <span>
            <strong>COREX</strong>
            <small>AI WORKFLOW AUTOMATION</small>
          </span>
        </a>
      </header>

      <article className="privacy-card">
        <p className="privacy-kicker">PUBLIC POLICY</p>
        <h1>Terms of Service</h1>
        <p className="privacy-updated">Last updated: August 11, 2026</p>

        <p>
          These Terms of Service govern your use of COREX. By using COREX, you agree to these
          terms.
        </p>

        <section>
          <h2>Use of the Application</h2>
          <p>
            You agree to use COREX only for lawful purposes and in accordance with
            applicable laws and third-party platform rules.
          </p>
        </section>

        <section>
          <h2>Connected Accounts</h2>
          <p>
            If you connect a supported account, including Google, Meta, or TikTok, you authorize
            COREX to use the permissions you approve through that service&apos;s authentication
            system. You are responsible for maintaining the security of your connected accounts.
          </p>
        </section>

        <section>
          <h2>Content</h2>
          <p>
            You are responsible for content generated, uploaded, published, or otherwise managed
            through COREX. You must ensure that your content complies with applicable laws and
            the policies of each connected service.
          </p>
        </section>

        <section>
          <h2>Prohibited Use</h2>
          <p>
            You must not use COREX for illegal activities, abuse, unauthorized access, spam, or
            activities that violate the policies of connected or other applicable services.
          </p>
        </section>

        <section>
          <h2>Availability</h2>
          <p>
            We do not guarantee that COREX will always be available, uninterrupted, or
            error-free.
          </p>
        </section>

        <section>
          <h2>Third-Party Services</h2>
          <p>
            COREX may rely on third-party services. We are not responsible for changes,
            interruptions, or failures caused by third-party services.
          </p>
        </section>

        <section>
          <h2>Limitation of Liability</h2>
          <p>
            To the extent permitted by applicable law, the COREX operator shall not be liable for
            indirect, incidental, or consequential damages resulting from use of COREX.
          </p>
        </section>

        <section>
          <h2>Changes to These Terms</h2>
          <p>
            These Terms of Service may be updated from time to time. Continued use of the
            COREX after changes are published constitutes acceptance of the updated terms.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            If you have questions about these Terms of Service, please contact the COREX operator.
          </p>
        </section>

        <p><a href="/">Back to COREX</a></p>
      </article>

      <footer className="privacy-footer">COREX · AI Workflow Automation</footer>
    </main>
  );
}
