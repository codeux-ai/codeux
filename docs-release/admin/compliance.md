# Data Lifecycle and Compliance

This document outlines the standard data lifecycle policies, deletion procedures, and encryption standards applied within the platform.

## Data Retention and Soft Deletion

When active items are removed from the workspace, they enter a soft-deletion state before permanent removal.

* **Soft Delete Window**: Projects and tasks deleted by users are retained in a soft-deleted state for 30 days.
* **Recovery**: During the 30-day window, workspace administrators can restore the deleted entities.
* **Permanent Deletion**: Once the 30-day period expires, the data is automatically and permanently expunged from the system databases.

## GDPR Account Deletion Requests

Users have the ability to exercise their right to erasure under GDPR.

* **Process**: Full account deletion requests must be submitted in writing to the support team or initiated through the account management portal.
* **Scope**: A full deletion request removes all personally identifiable information (PII) and associated user profiles from active databases.
* **Timeline**: The system processes permanent deletion within standard statutory timeframes upon verification of the request.

## Encryption Standards

Data protection measures are implemented across the platform to secure information both while stored and during transmission.

| State | Encryption Method | Description |
| --- | --- | --- |
| **In Transit** | TLS 1.2+ | All data transmitted between clients, the application, and the databases is secured using Transport Layer Security. |
| **At Rest** | AES-256 | Data stored in primary databases and backup volumes is encrypted at rest using Advanced Encryption Standard (AES) with 256-bit keys. |
