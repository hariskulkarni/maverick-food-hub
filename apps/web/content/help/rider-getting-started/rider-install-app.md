---
title: Install or update the Flavrly Rider app
summary: Download the Android app from flavrly.in, allow the install once, check the file is genuine, keep it up to date, and what the web rider portal can do.
audience: RIDER
appArea: rider.home
tags: install, download, apk, update, android, unknown sources, sha-256, checksum, web portal, rider portal
related: rider-sign-in-with-otp, rider-app-tour-and-profile, rider-kyc-documents
language: en
---
## Where to download

The Flavrly Rider app is an Android app. Download it only from Flavrly:

- On your phone, open [flavrly.in/rider-app](/rider-app) and tap **Download for Android**, or go straight to [flavrly.in/download/rider-app](/download/rider-app).
- On a computer, open the same page and scan the QR code with your Android phone's camera.

The download card shows the version, the file size, the release date and what's new.

## Allow the install (first time only)

The app is installed from the website, not the Play Store, so Android asks once:

1. When the download finishes, tap the notification (or open **Downloads**) and tap the file.
2. Android says **"For your security, your phone is not allowed to install unknown apps from this source"**. Tap **Settings**.
3. Turn on **Allow from this source** for Chrome (or the browser you used), then tap back.
4. Tap **Install**, then **Open**, and sign in with your rider phone number. See [Sign in to the rider app](help:rider-sign-in-with-otp).

You only need to allow this once per browser.

## Check the file is genuine (optional)

The download card shows a **SHA-256 checksum**. If you downloaded the file on a computer, you can compare it before copying the app to your phone:

- **Windows**: open Command Prompt in your Downloads folder and run `certutil -hashfile flavrly-rider-<version>.apk SHA256`.
- **Mac**: open Terminal and run `shasum -a 256 ~/Downloads/flavrly-rider-<version>.apk`.

The long code it prints must match the checksum on the download card exactly. If it doesn't, delete the file and download it again from flavrly.in.

## Keeping the app up to date

- When a newer version is published, the app shows an **Update available** banner. Tap **Download** to get the new file and install it over the old one. Your account and earnings stay as they are.
- If your version is too old to keep working safely, the app shows an **Update required** screen. Download and install the update to continue. The emergency call button still works on that screen.

## The web rider portal

You can also sign in on the web at [flavrly.in/rider](/rider) with the same phone number and code. The portal shows your earnings, lets you request payouts, upload KYC documents, book shifts, take training, read help articles and edit your profile and emergency contacts.

Going online and running deliveries only works in the app, because live GPS tracking is required. You can be signed in on the web and in the app at the same time — signing in or out of the web portal never signs the app on your phone out.
