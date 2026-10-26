---
title: Platform team: test customer and test rider accounts (super admin)
summary: For Flavrly super admins. How to create, use and delete pre-launch test accounts whose login code appears on screen, and how test orders are kept away from real riders.
audience: ALL
appArea: platform.users.test-accounts
tags: super admin, platform, test account, test rider, test customer, otp, pre-launch, demo, login code
related: platform-rider-operations-settings
language: en
---
This page is for the Flavrly platform team. Test accounts let the team try the live site and the rider app before launch without an SMS: the 6-digit login code is shown on the login screen instead.

Only a **Super Admin** signed in with **Google Authenticator (2FA)** can manage them, at **Platform → Customers & support → Test accounts**. Every create and delete is recorded in **Platform → Audit log** (`user.test_account.create`, `user.test_account.delete`).

## Create a test account

1. Open **Test accounts** and choose **Rider** or **Customer**.
2. Enter a 10-digit mobile number that **nobody uses**. A number that belongs to any real customer, rider or staff account is refused, and so is a number already used by a test account of the other type.
3. Confirm. A test rider is created approved and ready to go online.

## Sign in with it

- **Test customer:** on the Flavrly site, sign in with the number. The code appears in a yellow **Test account** box.
- **Test rider:** sign in at **flavrly.in/rider/login** or in the rider app with the number. The code is shown on screen and pre-filled. (The "Test account" label in the app needs the latest app build.)

**Anyone who knows the number can sign in as that account while it exists.** Keep the numbers private.

## How test orders are kept separate

- A test rider only ever sees, claims, is invited to or is assigned orders placed by a **test customer**.
- Real riders never see, get pushed or get assigned test-customer orders. Place a test order and deliver it with the test rider.
- Test riders are not counted as online fleet on Live tracking, Live ops or the demand zones.
- The KYC gate is waived for test riders, because they can only ever carry test orders.
- Test riders cannot request payouts.

## Delete before launch

Press **Delete** next to each test account. Its on-screen codes stop at once, it is signed out everywhere, it can no longer sign in, and a test rider is taken offline. This cannot be undone. Delete every test account before the public launch.
