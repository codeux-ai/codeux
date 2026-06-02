# Enforce Single Sign-On (SSO)

## Overview
This guide explains how Enterprise admins can enforce SAML Single Sign-On (SSO) for their workspace, ensuring all members authenticate via your Identity Provider (IdP).

::: info
Enforcing SSO will require all non-admin users to log in using the configured IdP.
:::

## Before you start
* You must have **Owner** or **Admin** permissions for the workspace.
* You need access to configure your Identity Provider (IdP) (e.g., Okta, Microsoft Entra ID).
* Ensure you have obtained your Identity Provider's SSO URL and X.509 Certificate in base64 format.

## Steps

1. **Obtain Code UX Configuration Details**
   Log into your workspace and navigate to **Settings > Security**. Under the SSO section, locate and copy the **ACS URL** and **Entity ID** provided for your workspace.

2. **Configure Your Identity Provider (IdP)**
   In your IdP's admin portal, create a new SAML application. Paste the **ACS URL** and **Entity ID** you copied from Code UX into the corresponding fields in your IdP configuration.

3. **Provide IdP Details to Code UX**
   Back in Code UX **Settings > Security**, enter your IdP's Single Sign-On URL. Then, paste your IdP's **X.509 Certificate** into the certificate field. Ensure the certificate is exactly in **X.509 base64 formatting**, including the `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----` headers.

4. **Test the Connection**
   Before enforcing SSO globally, click the **Test Connection** button. You will be redirected to your IdP to authenticate. If successful, you will return to Code UX with a success message. Do not proceed to enforcement until this test is successful.

5. **Enforce SSO Globally**
   Once the test is successful, toggle the **Enforce SSO** switch to the "On" position and click **Save Changes**.

## Troubleshooting

### Invalid SAML Response
If you encounter an "Invalid SAML Response" error during the test:
* Verify that the X.509 certificate pasted into Code UX exactly matches the certificate provided by your IdP, and is in X.509 base64 formatting.
* Ensure the ACS URL and Entity ID configured in your IdP exactly match the values provided in your workspace settings.

::: danger
### Account Lockout Recovery
If SSO is enforced and your IdP experiences downtime or becomes misconfigured, regular users will be unable to log in. Workspace Owners retain the ability to bypass SSO. To recover from a lockout:
1. Navigate to the Code UX login page.
2. Click **Sign in with email and password** to bypass SSO using your Workspace Owner credentials.
3. Navigate to **Settings > Security** and disable **Enforce SSO** until the IdP issue is resolved.
:::

## Expected Result
SSO is successfully tested and enforced. All workspace members will now be required to authenticate through your Identity Provider when logging into Code UX.
