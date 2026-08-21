import "./PrivacyPolicy.css";

const SITE_URL = "https://direngineeringsolutionscom.com";

export default function PrivacyPolicy() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a className="privacy-brand" href="/" aria-label="Jarvis home">
          <span className="privacy-logo" aria-hidden="true">J</span>
          <span>
            <strong>JARVIS</strong>
            <small>AI WORKFLOW AUTOMATION</small>
          </span>
        </a>
      </header>

      <article className="privacy-card">
        <p className="privacy-kicker">PUBLIC POLICY</p>
        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: August 21, 2026</p>

        <p>
          This Privacy Policy explains how Jarvis handles information when you use its
          workflow builder and connect supported Google or Meta accounts.
        </p>

        <section>
          <h2>Information collected</h2>
          <p>
            Jarvis stores workflow configurations and execution information needed to run
            workflows. When you connect an account, it may also store the account identifier,
            display name, email address when provided by the service, connection status, and
            timestamps. Jarvis processes the inputs and results produced by the workflow nodes
            you choose to execute.
          </p>
        </section>

        <section>
          <h2>Google OAuth and Google Drive data</h2>
          <p>
            Google OAuth lets you connect one or more Google accounts. Jarvis uses the selected
            account to perform the Google Drive operations you request, including searching,
            downloading, or deleting Drive files. Drive file metadata and operation results may
            appear in workflow execution output. Jarvis does not request your Google password.
          </p>
        </section>

        <section>
          <h2>Meta/Facebook OAuth and Page data</h2>
          <p>
            Meta OAuth lets you connect one or more Meta accounts. Current Facebook functionality
            is read-only: Jarvis can test the connection, retrieve the current Meta user, list
            accessible Facebook Pages, and retrieve Page metadata. Page access credentials are
            handled only by the server and are not shown in the browser. Jarvis does not currently
            publish, modify, or delete Facebook content.
          </p>
        </section>

        <section>
          <h2>How data is used</h2>
          <p>
            Information is used to authenticate connected accounts, display connection identity
            and status, execute user-requested workflow operations, preserve workflows, provide
            execution results and history, troubleshoot failures, and protect the service.
          </p>
        </section>

        <section>
          <h2>Credential and token security</h2>
          <p>
            OAuth access tokens, refresh tokens, and Facebook Page access tokens remain on the
            server. Stored token data is encrypted using authenticated AES-256-GCM encryption.
            Tokens are not returned in API responses and are not stored in workflow configuration,
            local storage, or session storage. Signed OAuth state is used to protect connection
            flows against request forgery and tampering.
          </p>
        </section>

        <section>
          <h2>Data storage and retention</h2>
          <p>
            Connected-account records and encrypted credentials are stored in the application's
            server-side database. Saved workflow configuration is stored in the user's browser, while
            workflow execution records are stored server-side. Credentials are retained until they
            are disconnected or deleted. Browser data remains until it is replaced or cleared, and
            server-side execution data remains until it is removed through an approved deletion request.
          </p>
        </section>

        <section>
          <h2>Sharing of data</h2>
          <p>
            Jarvis sends data to Google or Meta only as needed to complete the operations you
            request. Data may also be processed by infrastructure providers used to host and operate
            the application, subject to their service obligations. Jarvis does not sell or rent user
            data. Information may be disclosed when required by law or necessary to protect the
            service and its users.
          </p>
        </section>

        <section>
          <h2>User choices and account disconnection</h2>
          <p>
            You choose which credential each workflow node uses. You can reconnect or disconnect an
            individual Google or Meta credential without replacing other connected accounts. You may
            also manage or revoke Jarvis access through the security settings of the connected Google
            or Meta account.
          </p>
        </section>

        <section>
          <h2>Data deletion requests</h2>
          <p>
            Disconnect credentials in Jarvis to remove their stored connection records. To request
            deletion of other account-related information, contact the site administrator using the
            contact information below and identify the connected account without sending passwords,
            access tokens, or other secrets.
          </p>
        </section>

        <section>
          <h2>Contact information</h2>
          <p>
            Contact the Jarvis site administrator through the official website at{" "}
            <a href={SITE_URL}>{SITE_URL}</a>. Do not include OAuth tokens, passwords, or other
            credentials in a privacy or deletion request.
          </p>
        </section>
      </article>

      <footer className="privacy-footer">Jarvis · AI Workflow Automation</footer>
    </main>
  );
}
