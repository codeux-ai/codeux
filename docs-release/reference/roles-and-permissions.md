# Roles and Permissions

Sprint OS uses a role-based access control (RBAC) system to manage what users can see and do within Workspaces and Projects. Understanding these roles is crucial for maintaining security and effective collaboration.

## Workspace Roles

Workspace roles govern access to high-level administrative settings, billing, and member management across the entire organization.

*   **Workspace Owner**
    *   Full administrative control over the Workspace.
    *   Can manage billing, delete the Workspace, and configure SSO.
    *   Can invite, remove, and change roles for any member.
*   **Workspace Admin**
    *   Can manage Workspace settings and integrations.
    *   Can invite new members and manage most user roles.
    *   Cannot delete the Workspace or change the Workspace Owner.
*   **Workspace Member**
    *   Standard access to the Workspace.
    *   Can view and join Workspace-visible Projects.
    *   Cannot access billing, SSO, or overarching administrative settings.

## Project Roles

Project roles are scoped exclusively to individual Projects and define what a user can do within that specific collaboration boundary.

*   **Project Admin**
    *   Full control over the Project settings and lifecycle.
    *   Can invite members to Private Projects.
    *   Can archive or delete the Project.
*   **Editor**
    *   Can create, modify, and delete Tasks within the Project.
    *   Can comment and change Task statuses.
    *   Cannot change Project-level settings or manage Project access.
*   **Viewer**
    *   Read-only access to the Project and its Tasks.
    *   Can view Task details and comments.
    *   Cannot modify Tasks or participate in discussions.

## Permission Matrix Summary

| Action | Workspace Owner | Workspace Admin | Project Admin | Editor | Viewer |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Manage Billing** | Yes | No | No | No | No |
| **Workspace Settings**| Yes | Yes | No | No | No |
| **Delete Project** | Yes | Yes | Yes | No | No |
| **Create Tasks** | Yes | Yes | Yes | Yes | No |
| **View Tasks** | Yes | Yes | Yes | Yes | Yes |