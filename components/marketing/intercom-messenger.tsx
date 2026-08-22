"use client";

import { useEffect } from "react";
import Intercom from "@intercom/messenger-js-sdk";

const APP_ID = process.env.NEXT_PUBLIC_INTERCOM_APP_ID;

export function IntercomMessenger() {
  useEffect(() => {
    if (!APP_ID) return;
    Intercom({ app_id: APP_ID });
  }, []);

  return null;
}
