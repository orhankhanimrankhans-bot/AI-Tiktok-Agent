import "./PrivacyPolicy.css";

const CONTACT_EMAIL = "muhammadkazimamzksa@gmail.com";

export default function PrivacyPolicy() {
  return (
    <main className="privacy-page">
      <header className="privacy-header">
        <a className="privacy-brand" href="/" aria-label="Corex home">
          <span className="privacy-logo" aria-hidden="true">J</span>
          <span>
            <strong>COREX</strong>
            <small>AI WORKFLOW AUTOMATION</small>
          </span>
        </a>
      </header>

      <article className="privacy-card">
        <p className="privacy-kicker">PUBLIC POLICY</p>
        <h1>Privacy Policy</h1>
        <p className="privacy-updated">Last updated: September 23, 2026</p>

        <p>
          This Privacy Policy explains how Corex handles information when you use its
          workflow builder and connect supported Google, Meta, YouTube, or TikTok accounts.
        </p>

        <section>
          <h2>Information collected</h2>
          <p>
            Corex stores workflow configurations and execution information needed to run
            workflows. When you connect an account, it may also store the account identifier,
            display name, email address when provided by the service, connection status, and
            timestamps. Corex processes the inputs and results produced by the workflow nodes
            you choose to execute.
          </p>
        </section>

        <section>
          <h2>Google OAuth and Google Drive data</h2>
          <p>
            Google OAuth lets you connect one or more Google accounts. Corex uses the selected
            account to perform the Google Drive operations you request, including searching,
            downloading, or deleting Drive files. Drive file metadata and operation results may
            appear in workflow execution output. Corex does not request your Google password.
          </p>
        </section>

        <section>
          <h2>Meta/Facebook OAuth and Page data</h2>
          <p>
            Meta OAuth lets you connect Meta accounts and select Facebook Pages you manage.
            Corex uses granted permissions to retrieve account and Page information, publish
            Facebook Reels when you run or schedule a publishing workflow, and check publication
            status. It stores Page identifiers, publication records, and available performance
            information to display results and help avoid duplicate publishing. Page access
            credentials are handled by the server and are not shown in the browser.
          </p>
        </section>

        <section>
          <h2>TikTok connection and uploads</h2>
          <p>
            Corex stores your TikTok account identifier, display name, granted permissions, and
            encrypted access and refresh tokens in your workspace. After you preview a selected
            video and explicitly consent, Corex transfers it to TikTok. You may also authorize a
            TikTok workflow node to send its input videos on manual or scheduled runs. Inbox uploads
            are finished in TikTok. Where Direct Post is enabled, you review and approve each video's
            caption, privacy and other settings before a manual or scheduled run publishes it.
            TikTok processes received content under its own policies.
          </p>
          <p>
            Video bytes selected on the TikTok page are processed temporarily in server memory
            for transfer, without saving a video file. Workflow videos use the existing workspace-owned
            downloaded media storage and retention controls. Upload identifiers, file fingerprints for
            duplicate detection, timestamps, and status are retained until you disconnect TikTok.
            Direct Post also retains the approved caption, settings and consent record. For approved
            Direct Posts, TikTok retrieves the video through an expiring, single-video link.
            Disconnecting removes those account and upload records from Corex and attempts to
            revoke access. If revocation fails, revoke Corex access in TikTok account settings.
          </p>
        </section>

        <section>
          <h2>Content preparation and YouTube</h2>
          <p>
            Content preparation sends selected media, prompts, and inputs to the configured AI
            provider, such as Google or OpenAI. Requested YouTube uploads send the selected video
            and metadata to Google. Only process content you are authorized to use and share.
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
            local storage, or session storage. Session-bound OAuth state is used to protect connection
            flows against request forgery and tampering.
          </p>
        </section>

        <section>
          <h2>Data storage and retention</h2>
          <p>
            Connected-account records and encrypted credentials are stored in the application's
            server-side database. Workflow configurations may be stored in the user's browser or
            server-side workspace; execution and publication records are stored server-side.
            Credentials are retained until they
            are disconnected or deleted. Browser data remains until it is replaced or cleared, and
            server-side execution data remains until it is removed through an approved deletion request.
          </p>
        </section>

        <section>
          <h2>Sharing of data</h2>
          <p>
            Corex sends data to Google, Meta, or TikTok as needed to complete the operations you request.
            AI workflow steps may send selected video, text, or generated analysis to configured
            providers such as Google Gemini/Vertex AI and OpenAI for analysis and content generation.
            Data may also be processed by infrastructure providers used to host and operate
            the application, subject to their service obligations. Corex does not sell or rent user
            data. Information may be disclosed when required by law or necessary to protect the
            service and its users.
          </p>
        </section>

        <section>
          <h2>User choices and account disconnection</h2>
          <p>
            You choose which credential each workflow node uses. You can reconnect or disconnect an
            individual Google or Meta credential without replacing other connected accounts. You may
            also manage or revoke Corex access through the security settings of the connected Google
            or Meta account.
          </p>
        </section>

        <section>
          <h2>Data deletion requests</h2>
          <p>
            Disconnect credentials in Corex to remove their stored connection records. To request
            deletion of other account-related information, contact the site administrator using the
            contact information below and identify the connected account without sending passwords,
            access tokens, or other secrets. See the <a href="/data-deletion">data deletion instructions</a>
            {" "}for the steps and request details.
          </p>
        </section>

        <section>
          <h2>Contact information</h2>
          <p>
            Contact the Corex site administrator at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Do not include OAuth tokens, passwords, or other
            credentials in a privacy or deletion request.
          </p>
        </section>
      </article>

      <footer className="privacy-footer">Corex · AI Workflow Automation</footer>
    </main>
  );
}
