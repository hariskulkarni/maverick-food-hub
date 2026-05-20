-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CUSTOMER', 'ADMIN', 'KITCHEN', 'RIDER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "RestaurantStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiderApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PAYMENT_PENDING', 'PAYMENT_FAILED', 'RECEIVED', 'ACCEPTED', 'PREPARING', 'READY', 'RIDER_ASSIGNED', 'RIDER_REACHED_RESTAURANT', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'RIDER_REACHED_CUSTOMER', 'DELIVERY_OTP_FAILED', 'CUSTOMER_UNREACHABLE', 'DELIVERY_FAILED', 'DELIVERED', 'CANCELLED', 'CANCELLED_BY_CUSTOMER', 'CANCELLED_BY_RESTAURANT', 'CANCELLED_BY_ADMIN', 'REFUND_PENDING', 'REFUND_INITIATED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('CUSTOMER_CHANGED_MIND', 'CUSTOMER_WRONG_ADDRESS', 'RESTAURANT_TOO_BUSY', 'RESTAURANT_OUT_OF_STOCK', 'RESTAURANT_KITCHEN_CLOSED', 'RIDER_VEHICLE_ISSUE', 'RIDER_PERSONAL_EMERGENCY', 'CUSTOMER_UNREACHABLE', 'PAYMENT_FAILED', 'FRAUD_SUSPECTED', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('RAZORPAY', 'COD', 'WALLET');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('PENDING', 'ACCEPTED', 'PICKED_UP', 'DELIVERED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'WHATSAPP', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationProvider" AS ENUM ('RAZORPAY', 'TWILIO_SMS', 'TWILIO_WHATSAPP', 'SMTP', 'S3', 'PLATFORM_2FA');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'PHONE_VERIFY', 'RESET_PASSWORD');

-- CreateEnum
CREATE TYPE "EscalationType" AS ENUM ('ORDER_NOT_ACCEPTED', 'KITCHEN_DELAY', 'NO_RIDER_AVAILABLE', 'RIDER_NOT_MOVING', 'CUSTOMER_UNREACHABLE', 'PAYMENT_WEBHOOK_DELAY', 'COD_NOT_RECONCILED');

-- CreateEnum
CREATE TYPE "EscalationSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "CodStatus" AS ENUM ('PENDING_COLLECTION', 'COLLECTED', 'PARTIAL_COLLECTED', 'MISMATCH', 'DEPOSIT_PENDING', 'RECONCILED', 'WAIVED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WalletTxnType" AS ENUM ('TOPUP', 'ORDER_DEBIT', 'REFUND', 'REFERRAL_REWARD', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LoyaltyTxnType" AS ENUM ('EARN', 'REDEEM', 'EXPIRE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "InventoryMovementType" AS ENUM ('RESTOCK', 'CONSUME', 'WASTE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "RiderDispatchMode" AS ENUM ('FLEET_ONLY', 'DEDICATED_ONLY', 'DEDICATED_FIRST');

-- CreateEnum
CREATE TYPE "FulfillmentType" AS ENUM ('DELIVERY', 'PICKUP', 'DINE_IN');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'SEATED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "FeedbackIssueTag" AS ENUM ('LATE_DELIVERY', 'MISSING_ITEM', 'WRONG_ITEM', 'COLD_FOOD', 'PACKAGING_ISSUE', 'RIDER_BEHAVIOR', 'FOOD_QUALITY');

-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('PERCENTAGE', 'FIXED', 'BUY_X_GET_Y', 'COMBO_DISCOUNT', 'FREE_ITEM_ABOVE', 'FIRST_ORDER', 'REPEAT_CUSTOMER', 'DINE_IN_TO_ONLINE', 'ONLINE_TO_DINE_IN');

-- CreateEnum
CREATE TYPE "ChannelScope" AS ENUM ('ANY', 'ONLINE', 'DINE_IN');

-- CreateEnum
CREATE TYPE "CampaignChannel" AS ENUM ('DINE_IN_TO_ONLINE', 'ONLINE_TO_DINE_IN');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "HappyHourScope" AS ENUM ('RESTAURANT', 'CATEGORY', 'MENU_ITEM', 'COMBO');

-- CreateEnum
CREATE TYPE "HappyHourDiscountType" AS ENUM ('PERCENTAGE', 'FIXED_PRICE', 'FIXED_AMOUNT_OFF');

-- CreateEnum
CREATE TYPE "ChallengeType" AS ENUM ('ORDER_COUNT', 'SPEND_THRESHOLD', 'CUISINE_VARIETY', 'WEEKEND_STREAK', 'FIRST_N_ORDERS');

-- CreateEnum
CREATE TYPE "ChallengeWindow" AS ENUM ('LIFETIME', 'MONTHLY', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ChallengeRewardType" AS ENUM ('FIXED_OFF', 'PERCENT_OFF', 'FREE_DELIVERY');

-- CreateEnum
CREATE TYPE "RiderType" AS ENUM ('FLEET', 'DEDICATED');

-- CreateEnum
CREATE TYPE "BatchInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('RESTAURANT', 'BRANCH', 'TABLE', 'CAMPAIGN', 'TAKEAWAY');

-- CreateEnum
CREATE TYPE "AppPlatform" AS ENUM ('ANDROID_RIDER', 'IOS_RIDER', 'WEB');

-- CreateEnum
CREATE TYPE "TicketType" AS ENUM ('ORDER_DELAY', 'WRONG_ITEM', 'MISSING_ITEM', 'PAYMENT_ISSUE', 'REFUND_REQUEST', 'RIDER_ISSUE', 'FOOD_QUALITY', 'DELIVERY_NOT_RECEIVED', 'OTHER');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('AADHAAR', 'DRIVING_LICENSE', 'VEHICLE_INSURANCE', 'VEHICLE_RC', 'PAN_CARD');

-- CreateEnum
CREATE TYPE "KycDocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RiderPayoutStatus" AS ENUM ('REQUESTED', 'PROCESSING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "IncentivePeriod" AS ENUM ('DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "SosStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'HARASSMENT', 'VEHICLE_BREAKDOWN', 'THEFT', 'UNSAFE_LOCATION', 'CUSTOMER_DISPUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('BOOKED', 'STARTED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RiderReferralStatus" AS ENUM ('PENDING', 'SIGNED_UP', 'QUALIFIED', 'REWARDED');

-- CreateEnum
CREATE TYPE "TrainingCategory" AS ENUM ('ONBOARDING', 'SAFETY', 'CUSTOMER_SERVICE', 'EARNINGS', 'APP_GUIDE');

-- CreateEnum
CREATE TYPE "RiderTicketCategory" AS ENUM ('PAYMENT', 'APP_BUG', 'ORDER_ISSUE', 'KYC', 'ACCOUNT', 'SAFETY', 'OTHER');

-- CreateEnum
CREATE TYPE "RiderTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_ON_RIDER', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RiderConversationParty" AS ENUM ('ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "RiderMessageSender" AS ENUM ('RIDER', 'ADMIN', 'SUPER_ADMIN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "currentSessionId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Home',
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "ownerUserId" TEXT,
    "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restaurant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "cuisine" TEXT,
    "logoUrl" TEXT,
    "coverImageUrl" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "RestaurantStatus" NOT NULL DEFAULT 'PENDING',
    "ownerUserId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 15.0,
    "riderDispatchMode" "RiderDispatchMode" NOT NULL DEFAULT 'FLEET_ONLY',
    "fleetFallbackMinutes" INTEGER NOT NULL DEFAULT 5,
    "brandId" TEXT,
    "parentId" TEXT,
    "groupShareMenu" BOOLEAN NOT NULL DEFAULT false,
    "groupShareRiders" BOOLEAN NOT NULL DEFAULT false,
    "groupShareReports" BOOLEAN NOT NULL DEFAULT false,
    "autoAcceptOrders" BOOLEAN NOT NULL DEFAULT false,
    "scheduledOrdersEnabled" BOOLEAN NOT NULL DEFAULT true,
    "selfPickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowFreebies" BOOLEAN NOT NULL DEFAULT false,
    "dineInEnabled" BOOLEAN NOT NULL DEFAULT false,
    "reservationDeposit" DECIMAL(10,2) NOT NULL DEFAULT 200.00,
    "reservationDiscountPct" INTEGER NOT NULL DEFAULT 10,
    "reservationDurationMin" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantUser" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RestaurantUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderApplication" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "vehicleType" TEXT NOT NULL DEFAULT 'BIKE',
    "vehicleNumber" TEXT,
    "preferredZone" TEXT,
    "notes" TEXT,
    "status" "RiderApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPayoutRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL DEFAULT 30.00,
    "perKmAmount" DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    "firstKmIncluded" DECIMAL(6,2) NOT NULL DEFAULT 1.0,
    "longDistanceThresholdKm" DECIMAL(6,2) NOT NULL DEFAULT 5.0,
    "longDistanceBonusPerKm" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "perMinuteAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lunchPeakStartMin" INTEGER NOT NULL DEFAULT 720,
    "lunchPeakEndMin" INTEGER NOT NULL DEFAULT 870,
    "lunchPeakBonus" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "dinnerPeakStartMin" INTEGER NOT NULL DEFAULT 1140,
    "dinnerPeakEndMin" INTEGER NOT NULL DEFAULT 1380,
    "dinnerPeakBonus" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "lateNightStartMin" INTEGER NOT NULL DEFAULT 1320,
    "lateNightBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "weekendBonus" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "peakHourBonus" DECIMAL(10,2) NOT NULL DEFAULT 10.00,
    "rainBonus" DECIMAL(10,2) NOT NULL DEFAULT 15.00,
    "codHandlingFee" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "orderValueSharePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dailyTripBonusThreshold" INTEGER NOT NULL DEFAULT 0,
    "dailyTripBonusAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "weeklyTripBonusThreshold" INTEGER NOT NULL DEFAULT 0,
    "weeklyTripBonusAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ratingBonusThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingBonusAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "waitTimeStartMin" INTEGER NOT NULL DEFAULT 10,
    "waitTimePerMin" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "cancellationPayPct" INTEGER NOT NULL DEFAULT 50,
    "minimumPerDelivery" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "maxPerDelivery" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "DeliveryPayoutRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPayoutOverride" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "basePay" DECIMAL(10,2),
    "perKmRate" DECIMAL(10,2),
    "minPayout" DECIMAL(10,2),
    "maxPayout" DECIMAL(10,2),
    "codHandlingFee" DECIMAL(10,2),
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPayoutOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "line1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "serviceRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 7,
    "taxRatePct" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "baseDeliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 40.00,
    "perKmDeliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 8.00,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchUser" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BranchUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingHours" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openMin" INTEGER NOT NULL,
    "closeMin" INTEGER NOT NULL,

    CONSTRAINT "OperatingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestaurantTable" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RestaurantTable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "reservedAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 90,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "depositAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "depositPaid" BOOLEAN NOT NULL DEFAULT false,
    "depositPaymentRef" TEXT,
    "discountPct" INTEGER NOT NULL DEFAULT 10,
    "customerNotes" TEXT,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreebieRule" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minOrderAmount" DECIMAL(10,2) NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "totalGranted" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreebieRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "imageUrl" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CategoryAvailability" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "CategoryAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItem" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "isVeg" BOOLEAN NOT NULL DEFAULT true,
    "spicyLevel" INTEGER NOT NULL DEFAULT 0,
    "prepTimeMin" INTEGER NOT NULL DEFAULT 20,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemVariant" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuItemVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "modifierGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceDelta" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuItemAvailability" (
    "id" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "MenuItemAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Combo" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "imageUrl" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Combo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboItem" (
    "id" TEXT NOT NULL,
    "comboId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ComboItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addressId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'RECEIVED',
    "subtotal" DECIMAL(10,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "deliveryFee" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "discountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "walletApplied" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "loyaltyApplied" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "signupBonusApplied" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "total" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "customerNotes" TEXT,
    "isPriority" BOOLEAN NOT NULL DEFAULT false,
    "estimatedReadyAt" TIMESTAMP(3),
    "estimatedDeliveryAt" TIMESTAMP(3),
    "fulfillmentType" "FulfillmentType" NOT NULL DEFAULT 'DELIVERY',
    "scheduledFor" TIMESTAMP(3),
    "pickupCode" TEXT,
    "pickupCodeVerified" BOOLEAN NOT NULL DEFAULT false,
    "reservationId" TEXT,
    "reservationDepositApplied" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "freebieRuleId" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "preparingAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "outForDeliveryAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancellationReason" "CancellationReason",
    "cancelledBy" TEXT,
    "deliveryOtp" TEXT,
    "deliveryOtpVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderFeedback" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "foodRating" INTEGER,
    "deliveryRating" INTEGER,
    "overallRating" INTEGER,
    "comment" TEXT,
    "issueTags" "FeedbackIssueTag"[] DEFAULT ARRAY[]::"FeedbackIssueTag"[],
    "imageUrl" TEXT,
    "shareCommentWithRider" BOOLEAN NOT NULL DEFAULT false,
    "windowEndsAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "OrderFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "menuItemId" TEXT,
    "comboId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "notes" TEXT,
    "isFreebie" BOOLEAN NOT NULL DEFAULT false,
    "selectedVariantName" TEXT,
    "modifiersSummary" TEXT,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "percentOff" DOUBLE PRECISION,
    "flatOff" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "maxDiscount" DECIMAL(10,2),
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountOff" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "OfferType" NOT NULL,
    "code" TEXT,
    "percentOff" DOUBLE PRECISION,
    "flatOff" DECIMAL(10,2),
    "maxDiscount" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "rewardConfig" JSONB,
    "restaurantId" TEXT,
    "branchId" TEXT,
    "issuedChannel" "ChannelScope" NOT NULL DEFAULT 'ANY',
    "redeemChannel" "ChannelScope" NOT NULL DEFAULT 'ANY',
    "minCustomerOrders" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "autoApply" BOOLEAN NOT NULL DEFAULT false,
    "stackable" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferCategoryScope" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "OfferCategoryScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferItemScope" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,

    CONSTRAINT "OfferItemScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRedemption" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountOff" DECIMAL(10,2) NOT NULL,
    "breakdown" JSONB,
    "channel" "ChannelScope" NOT NULL DEFAULT 'ONLINE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponCampaign" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "codePrefix" TEXT NOT NULL,
    "channel" "CampaignChannel" NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "maxDiscount" DECIMAL(10,2),
    "minOrderAmount" DECIMAL(10,2),
    "maxUses" INTEGER,
    "perUserLimit" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "distributedCount" INTEGER NOT NULL DEFAULT 0,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CouponCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HappyHourRule" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scope" "HappyHourScope" NOT NULL,
    "categoryId" TEXT,
    "menuItemId" TEXT,
    "comboId" TEXT,
    "discountType" "HappyHourDiscountType" NOT NULL,
    "percentOff" DOUBLE PRECISION,
    "fixedPrice" DECIMAL(10,2),
    "amountOff" DECIMAL(10,2),
    "minPrice" DECIMAL(10,2),
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HappyHourRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HappyHourSchedule" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,

    CONSTRAINT "HappyHourSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossSell" (
    "id" TEXT NOT NULL,
    "parentItemId" TEXT NOT NULL,
    "suggestedItemId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "surface" TEXT NOT NULL DEFAULT 'pdp,cart',
    "kind" TEXT NOT NULL DEFAULT 'frequently_together',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrossSell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Challenge" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "brandId" TEXT,
    "restaurantId" TEXT,
    "type" "ChallengeType" NOT NULL,
    "target" INTEGER NOT NULL,
    "window" "ChallengeWindow" NOT NULL DEFAULT 'LIFETIME',
    "minOrderValue" DECIMAL(10,2),
    "rewardType" "ChallengeRewardType" NOT NULL,
    "rewardValue" DECIMAL(10,2) NOT NULL,
    "rewardMaxDiscount" DECIMAL(10,2),
    "rewardValidityDays" INTEGER NOT NULL DEFAULT 30,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "phoneVerifiedOnly" BOOLEAN NOT NULL DEFAULT true,
    "totalLimit" INTEGER,
    "totalIssued" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Challenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeProgress" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "lastOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChallengeProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChallengeReward" (
    "id" TEXT NOT NULL,
    "challengeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "phoneSnapshot" TEXT,
    "triggerOrderId" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemed" BOOLEAN NOT NULL DEFAULT false,
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "ChallengeReward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "providerName" TEXT,
    "providerRef" TEXT,
    "providerData" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "reason" TEXT,
    "providerRef" TEXT,
    "providerData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT,
    "riderType" "RiderType" NOT NULL DEFAULT 'FLEET',
    "dedicatedRestaurantId" TEXT,
    "vehicleType" TEXT NOT NULL DEFAULT 'BIKE',
    "vehicleNumber" TEXT,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "currentLat" DOUBLE PRECISION,
    "currentLng" DOUBLE PRECISION,
    "expoPushToken" TEXT,
    "currentLoad" INTEGER NOT NULL DEFAULT 0,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "totalDeliveries" INTEGER NOT NULL DEFAULT 0,
    "totalEarnings" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "totalTips" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderAssignment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'PENDING',
    "claimedAt" TIMESTAMP(3),
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "baseEarningsAmt" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "bonusAmt" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "tipAmt" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "earningsAmt" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "deliveryPhotoUrl" TEXT,
    "deliveryNote" TEXT,
    "customerRating" INTEGER,
    "customerComment" TEXT,
    "notes" TEXT,

    CONSTRAINT "RiderAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryLocationPing" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "orderId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchInvitation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "status" "BatchInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "detourKm" DOUBLE PRECISION NOT NULL,
    "extraEarnings" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "pickupEtaMin" INTEGER,
    "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "BatchInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "pointsBalance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarn" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeem" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "LoyaltyTxnType" NOT NULL,
    "points" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "orderId" TEXT,
    "type" "WalletTxnType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupBonusConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "totalAmount" DECIMAL(10,2) NOT NULL DEFAULT 100.00,
    "splitCount" INTEGER NOT NULL DEFAULT 5,
    "perOrderCap" DECIMAL(10,2),
    "minOrderValue" DECIMAL(10,2),
    "phoneCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "ipCheckEnabled" BOOLEAN NOT NULL DEFAULT true,
    "deviceCheckEnabled" BOOLEAN NOT NULL DEFAULT false,
    "validityDays" INTEGER NOT NULL DEFAULT 90,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupBonusConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupBonusGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "totalAmount" DECIMAL(10,2) NOT NULL,
    "perOrderCap" DECIMAL(10,2) NOT NULL,
    "usedAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remainingOrders" INTEGER NOT NULL,
    "phoneSnapshot" TEXT,
    "ipSnapshot" TEXT,
    "deviceSnapshot" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignupBonusGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignupBonusLedger" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL,
    "delta" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignupBonusLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT,
    "code" TEXT NOT NULL,
    "rewardForReferrer" DECIMAL(10,2) NOT NULL DEFAULT 100.00,
    "rewardForReferred" DECIMAL(10,2) NOT NULL DEFAULT 50.00,
    "fulfilledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "costPerUnit" DECIMAL(10,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "type" "InventoryMovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "note" TEXT,
    "refOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCredential" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "provider" "IntegrationProvider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "configEncrypted" TEXT NOT NULL,
    "summary" JSONB,
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "to" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "template" TEXT,
    "meta" JSONB,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDebounce" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,
    "payload" JSONB,

    CONSTRAINT "AlertDebounce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpAttempt" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "ipAddress" TEXT,
    "deviceHash" TEXT,
    "purpose" "OtpPurpose" NOT NULL DEFAULT 'LOGIN',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderEscalation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" "EscalationType" NOT NULL,
    "severity" "EscalationSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "message" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodCollection" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amountToCollect" DECIMAL(10,2) NOT NULL,
    "amountCollected" DECIMAL(10,2),
    "status" "CodStatus" NOT NULL DEFAULT 'PENDING_COLLECTION',
    "collectedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "reconciledBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CodCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "paymentId" TEXT,
    "orderId" TEXT,
    "providerEventId" TEXT,
    "signature" TEXT,
    "rawPayload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorRole" TEXT,
    "restaurantId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrCode" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "branchId" TEXT,
    "tableId" TEXT,
    "code" TEXT NOT NULL,
    "type" "QrType" NOT NULL DEFAULT 'RESTAURANT',
    "campaignName" TEXT,
    "scanCount" INTEGER NOT NULL DEFAULT 0,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QrCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteRestaurant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteRestaurant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "menuItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderHeartbeat" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLocationAt" TIMESTAMP(3),
    "batteryLevel" INTEGER,
    "gpsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "appVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppVersion" (
    "id" TEXT NOT NULL,
    "platform" "AppPlatform" NOT NULL,
    "minVersion" TEXT NOT NULL,
    "latestVersion" TEXT NOT NULL,
    "forceUpdate" BOOLEAN NOT NULL DEFAULT false,
    "updateUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "customerId" TEXT,
    "restaurantId" TEXT,
    "riderId" TEXT,
    "type" "TicketType" NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
    "message" TEXT NOT NULL,
    "assignedTo" TEXT,
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderKycDocument" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "status" "KycDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "numberEncrypted" TEXT,
    "numberLast4" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "fileMimeType" TEXT,
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,
    "rejectionReason" TEXT,
    "uploadedFromIp" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "verifierProvider" TEXT,
    "verifierStatus" TEXT,
    "verifierMessage" TEXT,
    "verifierResponse" JSONB,
    "verifierExternalRef" TEXT,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "RiderKycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPayout" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "RiderPayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "method" TEXT NOT NULL DEFAULT 'UPI',
    "upiId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "RiderPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderIncentive" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "period" "IncentivePeriod" NOT NULL DEFAULT 'DAILY',
    "targetDeliveries" INTEGER NOT NULL,
    "bonusAmount" DECIMAL(10,2) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderIncentive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderIncentiveProgress" (
    "id" TEXT NOT NULL,
    "incentiveId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "deliveriesDone" INTEGER NOT NULL DEFAULT 0,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    "achievedAt" TIMESTAMP(3),
    "bonusPaid" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderIncentiveProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'Busy area',
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusKm" DOUBLE PRECISION NOT NULL DEFAULT 2.0,
    "multiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgeZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderEmergencyContact" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relation" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderEmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SosAlert" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "SosStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedNote" TEXT,

    CONSTRAINT "SosAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderIncidentReport" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "IncidentType" NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "photoUrl" TEXT,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderIncidentReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripShare" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "token" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderShift" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "zoneName" TEXT,
    "status" "ShiftStatus" NOT NULL DEFAULT 'BOOKED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderPreferences" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "autoAccept" BOOLEAN NOT NULL DEFAULT false,
    "maxBatchSize" INTEGER NOT NULL DEFAULT 1,
    "notifyRadiusKm" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "preferredZones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "breakMode" BOOLEAN NOT NULL DEFAULT false,
    "breakUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderReferral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "refereePhone" TEXT,
    "refereeName" TEXT,
    "status" "RiderReferralStatus" NOT NULL DEFAULT 'PENDING',
    "bonusAmount" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "qualifiedAt" TIMESTAMP(3),
    "rewardedAt" TIMESTAMP(3),

    CONSTRAINT "RiderReferral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingModule" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "category" "TrainingCategory" NOT NULL DEFAULT 'ONBOARDING',
    "contentBody" TEXT NOT NULL,
    "quizQuestions" JSONB,
    "durationMin" INTEGER NOT NULL DEFAULT 5,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingModule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderTrainingProgress" (
    "id" TEXT NOT NULL,
    "moduleId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "quizScore" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderTrainingProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSupportTicket" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "category" "RiderTicketCategory" NOT NULL DEFAULT 'OTHER',
    "status" "RiderTicketStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderSupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderSupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromRider" BOOLEAN NOT NULL DEFAULT true,
    "authorName" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderSupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderConversation" (
    "id" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "party" "RiderConversationParty" NOT NULL,
    "restaurantId" TEXT,
    "subject" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiderConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiderConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "sender" "RiderMessageSender" NOT NULL,
    "senderName" TEXT,
    "body" TEXT NOT NULL,
    "readByRider" BOOLEAN NOT NULL DEFAULT false,
    "readByStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiderConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_phone_idx" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "UserSession_userId_createdAt_idx" ON "UserSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpToken_phone_purpose_idx" ON "OtpToken"("phone", "purpose");

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Brand_slug_key" ON "Brand"("slug");

-- CreateIndex
CREATE INDEX "Brand_status_idx" ON "Brand"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Restaurant_slug_key" ON "Restaurant"("slug");

-- CreateIndex
CREATE INDEX "Restaurant_status_idx" ON "Restaurant"("status");

-- CreateIndex
CREATE INDEX "Restaurant_brandId_idx" ON "Restaurant"("brandId");

-- CreateIndex
CREATE INDEX "Restaurant_parentId_idx" ON "Restaurant"("parentId");

-- CreateIndex
CREATE INDEX "RestaurantUser_userId_idx" ON "RestaurantUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RestaurantUser_restaurantId_userId_key" ON "RestaurantUser"("restaurantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderApplication_phone_key" ON "RiderApplication"("phone");

-- CreateIndex
CREATE INDEX "RiderApplication_status_idx" ON "RiderApplication"("status");

-- CreateIndex
CREATE INDEX "RiderPayoutOverride_riderId_isActive_idx" ON "RiderPayoutOverride"("riderId", "isActive");

-- CreateIndex
CREATE INDEX "RiderPayoutOverride_isActive_effectiveFrom_idx" ON "RiderPayoutOverride"("isActive", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_slug_key" ON "Branch"("slug");

-- CreateIndex
CREATE INDEX "Branch_isActive_idx" ON "Branch"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BranchUser_branchId_userId_key" ON "BranchUser"("branchId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "OperatingHours_branchId_dayOfWeek_key" ON "OperatingHours"("branchId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "RestaurantTable_branchId_isActive_idx" ON "RestaurantTable"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_code_key" ON "Reservation"("code");

-- CreateIndex
CREATE INDEX "Reservation_branchId_reservedAt_idx" ON "Reservation"("branchId", "reservedAt");

-- CreateIndex
CREATE INDEX "Reservation_customerId_reservedAt_idx" ON "Reservation"("customerId", "reservedAt");

-- CreateIndex
CREATE INDEX "Reservation_tableId_reservedAt_idx" ON "Reservation"("tableId", "reservedAt");

-- CreateIndex
CREATE INDEX "Reservation_status_reservedAt_idx" ON "Reservation"("status", "reservedAt");

-- CreateIndex
CREATE INDEX "FreebieRule_branchId_isActive_idx" ON "FreebieRule"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "FreebieRule_branchId_minOrderAmount_idx" ON "FreebieRule"("branchId", "minOrderAmount");

-- CreateIndex
CREATE INDEX "Category_branchId_idx" ON "Category"("branchId");

-- CreateIndex
CREATE INDEX "Category_branchId_isActive_scheduleEnabled_idx" ON "Category"("branchId", "isActive", "scheduleEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Category_branchId_slug_key" ON "Category"("branchId", "slug");

-- CreateIndex
CREATE INDEX "CategoryAvailability_categoryId_idx" ON "CategoryAvailability"("categoryId");

-- CreateIndex
CREATE INDEX "CategoryAvailability_categoryId_dayOfWeek_idx" ON "CategoryAvailability"("categoryId", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_inventoryItemId_key" ON "MenuItem"("inventoryItemId");

-- CreateIndex
CREATE INDEX "MenuItem_branchId_categoryId_idx" ON "MenuItem"("branchId", "categoryId");

-- CreateIndex
CREATE INDEX "MenuItem_branchId_isAvailable_idx" ON "MenuItem"("branchId", "isAvailable");

-- CreateIndex
CREATE UNIQUE INDEX "MenuItem_branchId_slug_key" ON "MenuItem"("branchId", "slug");

-- CreateIndex
CREATE INDEX "MenuItemVariant_menuItemId_sortOrder_idx" ON "MenuItemVariant"("menuItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "ModifierGroup_menuItemId_sortOrder_idx" ON "ModifierGroup"("menuItemId", "sortOrder");

-- CreateIndex
CREATE INDEX "ModifierOption_modifierGroupId_sortOrder_idx" ON "ModifierOption"("modifierGroupId", "sortOrder");

-- CreateIndex
CREATE INDEX "MenuItemAvailability_menuItemId_idx" ON "MenuItemAvailability"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Combo_branchId_slug_key" ON "Combo"("branchId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "ComboItem_comboId_menuItemId_key" ON "ComboItem"("comboId", "menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_code_key" ON "Order"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Order_reservationId_key" ON "Order"("reservationId");

-- CreateIndex
CREATE INDEX "Order_branchId_status_idx" ON "Order"("branchId", "status");

-- CreateIndex
CREATE INDEX "Order_branchId_status_createdAt_idx" ON "Order"("branchId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Order_customerId_createdAt_idx" ON "Order"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "Order_customerId_placedAt_idx" ON "Order"("customerId", "placedAt");

-- CreateIndex
CREATE INDEX "Order_status_placedAt_idx" ON "Order"("status", "placedAt");

-- CreateIndex
CREATE INDEX "Order_branchId_fulfillmentType_status_idx" ON "Order"("branchId", "fulfillmentType", "status");

-- CreateIndex
CREATE INDEX "Order_scheduledFor_idx" ON "Order"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "OrderFeedback_orderId_key" ON "OrderFeedback"("orderId");

-- CreateIndex
CREATE INDEX "OrderFeedback_customerId_createdAt_idx" ON "OrderFeedback"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "OrderFeedback_foodRating_idx" ON "OrderFeedback"("foodRating");

-- CreateIndex
CREATE INDEX "OrderFeedback_deliveryRating_idx" ON "OrderFeedback"("deliveryRating");

-- CreateIndex
CREATE INDEX "OrderFeedback_overallRating_idx" ON "OrderFeedback"("overallRating");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderStatusEvent_orderId_idx" ON "OrderStatusEvent"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_code_key" ON "Coupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_orderId_key" ON "CouponRedemption"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_code_key" ON "Offer"("code");

-- CreateIndex
CREATE INDEX "Offer_restaurantId_isActive_validFrom_validTo_idx" ON "Offer"("restaurantId", "isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "Offer_campaignId_idx" ON "Offer"("campaignId");

-- CreateIndex
CREATE INDEX "Offer_branchId_isActive_idx" ON "Offer"("branchId", "isActive");

-- CreateIndex
CREATE INDEX "Offer_autoApply_isActive_idx" ON "Offer"("autoApply", "isActive");

-- CreateIndex
CREATE INDEX "Offer_type_isActive_idx" ON "Offer"("type", "isActive");

-- CreateIndex
CREATE INDEX "OfferCategoryScope_categoryId_idx" ON "OfferCategoryScope"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferCategoryScope_offerId_categoryId_key" ON "OfferCategoryScope"("offerId", "categoryId");

-- CreateIndex
CREATE INDEX "OfferItemScope_menuItemId_idx" ON "OfferItemScope"("menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferItemScope_offerId_menuItemId_key" ON "OfferItemScope"("offerId", "menuItemId");

-- CreateIndex
CREATE INDEX "OfferRedemption_offerId_userId_idx" ON "OfferRedemption"("offerId", "userId");

-- CreateIndex
CREATE INDEX "OfferRedemption_userId_createdAt_idx" ON "OfferRedemption"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRedemption_offerId_orderId_key" ON "OfferRedemption"("offerId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponCampaign_codePrefix_key" ON "CouponCampaign"("codePrefix");

-- CreateIndex
CREATE INDEX "CouponCampaign_restaurantId_status_idx" ON "CouponCampaign"("restaurantId", "status");

-- CreateIndex
CREATE INDEX "CouponCampaign_channel_status_idx" ON "CouponCampaign"("channel", "status");

-- CreateIndex
CREATE INDEX "HappyHourRule_restaurantId_isActive_validFrom_validTo_idx" ON "HappyHourRule"("restaurantId", "isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "HappyHourRule_categoryId_isActive_idx" ON "HappyHourRule"("categoryId", "isActive");

-- CreateIndex
CREATE INDEX "HappyHourRule_menuItemId_isActive_idx" ON "HappyHourRule"("menuItemId", "isActive");

-- CreateIndex
CREATE INDEX "HappyHourRule_comboId_isActive_idx" ON "HappyHourRule"("comboId", "isActive");

-- CreateIndex
CREATE INDEX "HappyHourSchedule_ruleId_idx" ON "HappyHourSchedule"("ruleId");

-- CreateIndex
CREATE INDEX "HappyHourSchedule_ruleId_dayOfWeek_idx" ON "HappyHourSchedule"("ruleId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "CrossSell_parentItemId_isActive_idx" ON "CrossSell"("parentItemId", "isActive");

-- CreateIndex
CREATE INDEX "CrossSell_parentItemId_kind_isActive_idx" ON "CrossSell"("parentItemId", "kind", "isActive");

-- CreateIndex
CREATE INDEX "CrossSell_suggestedItemId_idx" ON "CrossSell"("suggestedItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CrossSell_parentItemId_suggestedItemId_kind_key" ON "CrossSell"("parentItemId", "suggestedItemId", "kind");

-- CreateIndex
CREATE INDEX "Challenge_isActive_validFrom_validTo_idx" ON "Challenge"("isActive", "validFrom", "validTo");

-- CreateIndex
CREATE INDEX "Challenge_brandId_isActive_idx" ON "Challenge"("brandId", "isActive");

-- CreateIndex
CREATE INDEX "Challenge_restaurantId_isActive_idx" ON "Challenge"("restaurantId", "isActive");

-- CreateIndex
CREATE INDEX "ChallengeProgress_userId_completed_idx" ON "ChallengeProgress"("userId", "completed");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeProgress_challengeId_userId_key" ON "ChallengeProgress"("challengeId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ChallengeReward_offerId_key" ON "ChallengeReward"("offerId");

-- CreateIndex
CREATE INDEX "ChallengeReward_userId_issuedAt_idx" ON "ChallengeReward"("userId", "issuedAt");

-- CreateIndex
CREATE INDEX "ChallengeReward_challengeId_issuedAt_idx" ON "ChallengeReward"("challengeId", "issuedAt");

-- CreateIndex
CREATE INDEX "ChallengeReward_phoneSnapshot_idx" ON "ChallengeReward"("phoneSnapshot");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_providerRef_idx" ON "Payment"("providerRef");

-- CreateIndex
CREATE UNIQUE INDEX "RiderProfile_userId_key" ON "RiderProfile"("userId");

-- CreateIndex
CREATE INDEX "RiderProfile_isOnline_idx" ON "RiderProfile"("isOnline");

-- CreateIndex
CREATE INDEX "RiderProfile_branchId_isOnline_idx" ON "RiderProfile"("branchId", "isOnline");

-- CreateIndex
CREATE INDEX "RiderProfile_riderType_isOnline_idx" ON "RiderProfile"("riderType", "isOnline");

-- CreateIndex
CREATE INDEX "RiderProfile_dedicatedRestaurantId_isOnline_idx" ON "RiderProfile"("dedicatedRestaurantId", "isOnline");

-- CreateIndex
CREATE UNIQUE INDEX "RiderAssignment_orderId_key" ON "RiderAssignment"("orderId");

-- CreateIndex
CREATE INDEX "RiderAssignment_riderId_status_idx" ON "RiderAssignment"("riderId", "status");

-- CreateIndex
CREATE INDEX "RiderAssignment_status_claimedAt_idx" ON "RiderAssignment"("status", "claimedAt");

-- CreateIndex
CREATE INDEX "DeliveryLocationPing_riderId_createdAt_idx" ON "DeliveryLocationPing"("riderId", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryLocationPing_orderId_createdAt_idx" ON "DeliveryLocationPing"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "BatchInvitation_riderId_status_idx" ON "BatchInvitation"("riderId", "status");

-- CreateIndex
CREATE INDEX "BatchInvitation_orderId_status_idx" ON "BatchInvitation"("orderId", "status");

-- CreateIndex
CREATE INDEX "BatchInvitation_status_expiresAt_idx" ON "BatchInvitation"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "BatchInvitation_orderId_riderId_key" ON "BatchInvitation"("orderId", "riderId");

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyAccount_userId_key" ON "LoyaltyAccount"("userId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_accountId_createdAt_idx" ON "LoyaltyTransaction"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "WalletTransaction_walletId_createdAt_idx" ON "WalletTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SignupBonusGrant_userId_key" ON "SignupBonusGrant"("userId");

-- CreateIndex
CREATE INDEX "SignupBonusGrant_phoneSnapshot_idx" ON "SignupBonusGrant"("phoneSnapshot");

-- CreateIndex
CREATE INDEX "SignupBonusGrant_ipSnapshot_idx" ON "SignupBonusGrant"("ipSnapshot");

-- CreateIndex
CREATE INDEX "SignupBonusLedger_grantId_createdAt_idx" ON "SignupBonusLedger"("grantId", "createdAt");

-- CreateIndex
CREATE INDEX "SignupBonusLedger_orderId_idx" ON "SignupBonusLedger"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Referral_code_key" ON "Referral"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_branchId_name_key" ON "InventoryItem"("branchId", "name");

-- CreateIndex
CREATE INDEX "InventoryMovement_itemId_createdAt_idx" ON "InventoryMovement"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "IntegrationCredential_provider_status_idx" ON "IntegrationCredential"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationCredential_restaurantId_provider_key" ON "IntegrationCredential"("restaurantId", "provider");

-- CreateIndex
CREATE INDEX "NotificationLog_userId_createdAt_idx" ON "NotificationLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_status_idx" ON "NotificationLog"("channel", "status");

-- CreateIndex
CREATE INDEX "AlertDebounce_lastSentAt_idx" ON "AlertDebounce"("lastSentAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDebounce_entityType_entityId_kind_key" ON "AlertDebounce"("entityType", "entityId", "kind");

-- CreateIndex
CREATE INDEX "OtpAttempt_phone_createdAt_idx" ON "OtpAttempt"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "OtpAttempt_ipAddress_createdAt_idx" ON "OtpAttempt"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEscalation_status_createdAt_idx" ON "OrderEscalation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrderEscalation_orderId_createdAt_idx" ON "OrderEscalation"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CodCollection_orderId_key" ON "CodCollection"("orderId");

-- CreateIndex
CREATE INDEX "CodCollection_riderId_status_idx" ON "CodCollection"("riderId", "status");

-- CreateIndex
CREATE INDEX "CodCollection_status_createdAt_idx" ON "CodCollection"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_providerEventId_key" ON "PaymentWebhookEvent"("providerEventId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_provider_eventType_createdAt_idx" ON "PaymentWebhookEvent"("provider", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_orderId_idx" ON "PaymentWebhookEvent"("orderId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_restaurantId_createdAt_idx" ON "AuditLog"("restaurantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX "Job_type_status_idx" ON "Job"("type", "status");

-- CreateIndex
CREATE INDEX "ErrorLog_level_createdAt_idx" ON "ErrorLog"("level", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_source_createdAt_idx" ON "ErrorLog"("source", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QrCode_code_key" ON "QrCode"("code");

-- CreateIndex
CREATE INDEX "QrCode_restaurantId_isActive_idx" ON "QrCode"("restaurantId", "isActive");

-- CreateIndex
CREATE INDEX "QrCode_code_idx" ON "QrCode"("code");

-- CreateIndex
CREATE INDEX "FavoriteRestaurant_userId_idx" ON "FavoriteRestaurant"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteRestaurant_userId_restaurantId_key" ON "FavoriteRestaurant"("userId", "restaurantId");

-- CreateIndex
CREATE INDEX "FavoriteItem_userId_idx" ON "FavoriteItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteItem_userId_menuItemId_key" ON "FavoriteItem"("userId", "menuItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderHeartbeat_riderId_key" ON "RiderHeartbeat"("riderId");

-- CreateIndex
CREATE INDEX "RiderHeartbeat_lastSeenAt_idx" ON "RiderHeartbeat"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppVersion_platform_key" ON "AppVersion"("platform");

-- CreateIndex
CREATE INDEX "SupportTicket_status_priority_createdAt_idx" ON "SupportTicket"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_orderId_idx" ON "SupportTicket"("orderId");

-- CreateIndex
CREATE INDEX "RiderKycDocument_status_submittedAt_idx" ON "RiderKycDocument"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "RiderKycDocument_expiresOn_idx" ON "RiderKycDocument"("expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "RiderKycDocument_riderId_type_key" ON "RiderKycDocument"("riderId", "type");

-- CreateIndex
CREATE INDEX "RiderPayout_riderId_status_idx" ON "RiderPayout"("riderId", "status");

-- CreateIndex
CREATE INDEX "RiderPayout_status_requestedAt_idx" ON "RiderPayout"("status", "requestedAt");

-- CreateIndex
CREATE INDEX "RiderIncentive_isActive_idx" ON "RiderIncentive"("isActive");

-- CreateIndex
CREATE INDEX "RiderIncentiveProgress_riderId_idx" ON "RiderIncentiveProgress"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderIncentiveProgress_incentiveId_riderId_periodKey_key" ON "RiderIncentiveProgress"("incentiveId", "riderId", "periodKey");

-- CreateIndex
CREATE INDEX "SurgeZone_isActive_idx" ON "SurgeZone"("isActive");

-- CreateIndex
CREATE INDEX "RiderEmergencyContact_riderId_idx" ON "RiderEmergencyContact"("riderId");

-- CreateIndex
CREATE INDEX "SosAlert_riderId_status_idx" ON "SosAlert"("riderId", "status");

-- CreateIndex
CREATE INDEX "SosAlert_status_triggeredAt_idx" ON "SosAlert"("status", "triggeredAt");

-- CreateIndex
CREATE INDEX "RiderIncidentReport_riderId_status_idx" ON "RiderIncidentReport"("riderId", "status");

-- CreateIndex
CREATE INDEX "RiderIncidentReport_status_createdAt_idx" ON "RiderIncidentReport"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripShare_token_key" ON "TripShare"("token");

-- CreateIndex
CREATE INDEX "TripShare_riderId_isActive_idx" ON "TripShare"("riderId", "isActive");

-- CreateIndex
CREATE INDEX "RiderShift_riderId_date_idx" ON "RiderShift"("riderId", "date");

-- CreateIndex
CREATE INDEX "RiderShift_date_status_idx" ON "RiderShift"("date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RiderPreferences_riderId_key" ON "RiderPreferences"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderReferral_code_key" ON "RiderReferral"("code");

-- CreateIndex
CREATE INDEX "RiderReferral_referrerId_status_idx" ON "RiderReferral"("referrerId", "status");

-- CreateIndex
CREATE INDEX "TrainingModule_isActive_order_idx" ON "TrainingModule"("isActive", "order");

-- CreateIndex
CREATE INDEX "RiderTrainingProgress_riderId_idx" ON "RiderTrainingProgress"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "RiderTrainingProgress_moduleId_riderId_key" ON "RiderTrainingProgress"("moduleId", "riderId");

-- CreateIndex
CREATE INDEX "RiderSupportTicket_riderId_status_idx" ON "RiderSupportTicket"("riderId", "status");

-- CreateIndex
CREATE INDEX "RiderSupportTicket_status_updatedAt_idx" ON "RiderSupportTicket"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "RiderSupportMessage_ticketId_createdAt_idx" ON "RiderSupportMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "RiderConversation_riderId_idx" ON "RiderConversation"("riderId");

-- CreateIndex
CREATE INDEX "RiderConversation_party_restaurantId_idx" ON "RiderConversation"("party", "restaurantId");

-- CreateIndex
CREATE INDEX "RiderConversation_lastMessageAt_idx" ON "RiderConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "RiderConversationMessage_conversationId_createdAt_idx" ON "RiderConversationMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpToken" ADD CONSTRAINT "OtpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restaurant" ADD CONSTRAINT "Restaurant_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantUser" ADD CONSTRAINT "RestaurantUser_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantUser" ADD CONSTRAINT "RestaurantUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderApplication" ADD CONSTRAINT "RiderApplication_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPayoutOverride" ADD CONSTRAINT "RiderPayoutOverride_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUser" ADD CONSTRAINT "BranchUser_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchUser" ADD CONSTRAINT "BranchUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingHours" ADD CONSTRAINT "OperatingHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestaurantTable" ADD CONSTRAINT "RestaurantTable_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "RestaurantTable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreebieRule" ADD CONSTRAINT "FreebieRule_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FreebieRule" ADD CONSTRAINT "FreebieRule_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryAvailability" ADD CONSTRAINT "CategoryAvailability_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItem" ADD CONSTRAINT "MenuItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemVariant" ADD CONSTRAINT "MenuItemVariant_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_modifierGroupId_fkey" FOREIGN KEY ("modifierGroupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuItemAvailability" ADD CONSTRAINT "MenuItemAvailability_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Combo" ADD CONSTRAINT "Combo_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboItem" ADD CONSTRAINT "ComboItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_freebieRuleId_fkey" FOREIGN KEY ("freebieRuleId") REFERENCES "FreebieRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFeedback" ADD CONSTRAINT "OrderFeedback_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderFeedback" ADD CONSTRAINT "OrderFeedback_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "CouponCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCategoryScope" ADD CONSTRAINT "OfferCategoryScope_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferCategoryScope" ADD CONSTRAINT "OfferCategoryScope_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItemScope" ADD CONSTRAINT "OfferItemScope_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferItemScope" ADD CONSTRAINT "OfferItemScope_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRedemption" ADD CONSTRAINT "OfferRedemption_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponCampaign" ADD CONSTRAINT "CouponCampaign_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourRule" ADD CONSTRAINT "HappyHourRule_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourRule" ADD CONSTRAINT "HappyHourRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourRule" ADD CONSTRAINT "HappyHourRule_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourRule" ADD CONSTRAINT "HappyHourRule_comboId_fkey" FOREIGN KEY ("comboId") REFERENCES "Combo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HappyHourSchedule" ADD CONSTRAINT "HappyHourSchedule_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "HappyHourRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossSell" ADD CONSTRAINT "CrossSell_parentItemId_fkey" FOREIGN KEY ("parentItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossSell" ADD CONSTRAINT "CrossSell_suggestedItemId_fkey" FOREIGN KEY ("suggestedItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Challenge" ADD CONSTRAINT "Challenge_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeProgress" ADD CONSTRAINT "ChallengeProgress_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeProgress" ADD CONSTRAINT "ChallengeProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReward" ADD CONSTRAINT "ChallengeReward_challengeId_fkey" FOREIGN KEY ("challengeId") REFERENCES "Challenge"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReward" ADD CONSTRAINT "ChallengeReward_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChallengeReward" ADD CONSTRAINT "ChallengeReward_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderProfile" ADD CONSTRAINT "RiderProfile_dedicatedRestaurantId_fkey" FOREIGN KEY ("dedicatedRestaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderAssignment" ADD CONSTRAINT "RiderAssignment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderAssignment" ADD CONSTRAINT "RiderAssignment_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryLocationPing" ADD CONSTRAINT "DeliveryLocationPing_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchInvitation" ADD CONSTRAINT "BatchInvitation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchInvitation" ADD CONSTRAINT "BatchInvitation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupBonusGrant" ADD CONSTRAINT "SignupBonusGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupBonusLedger" ADD CONSTRAINT "SignupBonusLedger_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "SignupBonusGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignupBonusLedger" ADD CONSTRAINT "SignupBonusLedger_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredId_fkey" FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntegrationCredential" ADD CONSTRAINT "IntegrationCredential_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationLog" ADD CONSTRAINT "NotificationLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderEscalation" ADD CONSTRAINT "OrderEscalation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodCollection" ADD CONSTRAINT "CodCollection_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrCode" ADD CONSTRAINT "QrCode_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteRestaurant" ADD CONSTRAINT "FavoriteRestaurant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteRestaurant" ADD CONSTRAINT "FavoriteRestaurant_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteItem" ADD CONSTRAINT "FavoriteItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FavoriteItem" ADD CONSTRAINT "FavoriteItem_menuItemId_fkey" FOREIGN KEY ("menuItemId") REFERENCES "MenuItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderKycDocument" ADD CONSTRAINT "RiderKycDocument_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPayout" ADD CONSTRAINT "RiderPayout_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderIncentiveProgress" ADD CONSTRAINT "RiderIncentiveProgress_incentiveId_fkey" FOREIGN KEY ("incentiveId") REFERENCES "RiderIncentive"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderIncentiveProgress" ADD CONSTRAINT "RiderIncentiveProgress_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderEmergencyContact" ADD CONSTRAINT "RiderEmergencyContact_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SosAlert" ADD CONSTRAINT "SosAlert_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderIncidentReport" ADD CONSTRAINT "RiderIncidentReport_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripShare" ADD CONSTRAINT "TripShare_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderShift" ADD CONSTRAINT "RiderShift_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderPreferences" ADD CONSTRAINT "RiderPreferences_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderReferral" ADD CONSTRAINT "RiderReferral_referrerId_fkey" FOREIGN KEY ("referrerId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderTrainingProgress" ADD CONSTRAINT "RiderTrainingProgress_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "TrainingModule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderTrainingProgress" ADD CONSTRAINT "RiderTrainingProgress_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSupportTicket" ADD CONSTRAINT "RiderSupportTicket_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderSupportMessage" ADD CONSTRAINT "RiderSupportMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "RiderSupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderConversation" ADD CONSTRAINT "RiderConversation_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "RiderProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiderConversationMessage" ADD CONSTRAINT "RiderConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "RiderConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

