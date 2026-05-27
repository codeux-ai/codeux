# Inviting Your Team

## Purpose and Scope
This guide provides a step-by-step process for inviting team members to your project to ensure a successful onboarding experience.

## Prerequisites

Before inviting team members, ensure the following requirements are met:
- You must have **Admin** or **Owner** privileges within the project.
- You have the email addresses of the team members you wish to invite.
- The project environment has been initialized and is ready for collaboration.

## Source files involved
- N/A (UI operation)

## Data flow or behavior summary
Administrators add emails via the UI, assigning a role. The system sends onboarding links to the provided email addresses. Once accepted, user accounts are linked to the project with the assigned permissions.

## Configuration and defaults
- **Default Role**: Viewer (unless specified otherwise during invitation).
- **Invitation Status**: Defaults to `Pending` until the user accepts, then changes to `Active`.

## Steps to Invite Team Members

1. **Navigate to Project Settings:** Log in to your dashboard and navigate to the desired project workspace.
2. **Access Team Management:** Click on the `Settings` icon in the navigation bar, then select the `Team` tab.
3. **Initiate Invitation:** Click the `Invite Members` button located in the top-right corner of the Team management page.
4. **Enter Details:** In the invitation modal, enter the email addresses of the individuals you want to invite. You can add multiple emails separated by commas.
5. **Assign Roles:** Select the appropriate role (e.g., Viewer, Contributor, Admin) for the invited members from the dropdown menu. Ensure the role aligns with their required access level.
6. **Send Invitation:** Click the `Send Invites` button. An automated email with an onboarding link will be sent to each recipient.

## Expected Result

Once the invitations are sent:
- The invited users will receive an email containing a secure link to join the workspace.
- The status of their invitation will appear as `Pending` in the Team management tab until they accept it.
- After acceptance, their status will change to `Active`, and they will have access to the project according to their assigned roles.

## Failure cases and troubleshooting notes
- **Emails not received**: Ask users to check spam folders. Verify the correct email address was entered.
- **Link expired**: Resend the invitation from the `Team` tab by selecting the user and choosing `Resend Invite`.
- **Role incorrect**: An admin can update the user's role from the `Team` tab after they have accepted the invitation.

## Related links
- [Getting Started - Quickstart](./quickstart.md)
