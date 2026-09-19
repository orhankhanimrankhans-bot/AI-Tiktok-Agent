import "./PrivacyPolicy.css";

const CONTACT_EMAIL = "muhammadkazimamzksa@gmail.com";

export default function DataDeletion() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a className="privacy-brand" href="/" aria-label="COREX home">
          <span className="privacy-logo" aria-hidden="true">C</span>
          <span><strong>COREX</strong><small>AI WORKFLOW AUTOMATION</small></span>
        </a>
      </header>
      <article className="privacy-card">
        <p className="privacy-kicker">PUBLIC POLICY</p>
        <h1>Data Deletion Instructions</h1>
        <p className="privacy-updated">Last updated: September 20, 2026</p>
        <p>You can remove a connected account or request deletion of information stored by COREX.</p>
        <section>
          <h2>Disconnect a Facebook account or Page</h2>
          <ol>
            <li>Sign in to your COREX workspace.</li>
            <li>Open the Facebook Graph account credential you want to remove.</li>
            <li>Check the account or Page identity, then click Disconnect.</li>
            <li>Repeat for other Page credentials you want removed.</li>
          </ol>
          <p>Disconnect removes that stored credential record and its tokens. Workflows using it
            will need a new connection. It does not automatically erase workflow history,
            publication records, or content already published on Facebook.</p>
        </section>
        <section>
          <h2>Request deletion of other stored data</h2>
          <p>Email <a href={`mailto:${CONTACT_EMAIL}?subject=COREX%20data%20deletion%20request`}>{CONTACT_EMAIL}</a>
            {" "}with the subject <strong>COREX data deletion request</strong>.</p>
          <ul>
            <li>Identify your COREX workspace and the connected account or Facebook Page name/ID.</li>
            <li>Describe the data you want deleted, such as connection records, saved workflows,
              stored media, execution history, or publication records.</li>
            <li>Provide an email address where the administrator can reply.</li>
          </ul>
          <p>Do not send passwords, App Secrets, access tokens, or other credentials. The
            administrator may ask you to verify ownership before processing your request and
            will reply with the outcome or any information needed to complete it.</p>
        </section>
        <section>
          <h2>Facebook access and published content</h2>
          <p>You can also revoke the connected Meta app through your Facebook account settings.
            Revoking access does not itself delete historical records in COREX; use the email
            instructions above to request their deletion. Manage or delete content already
            published to Facebook directly on the relevant Facebook Page.</p>
        </section>
        <p><a href="/privacy-policy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
      </article>
      <footer className="privacy-footer">COREX · AI Workflow Automation</footer>
    </main>
  );
}
