// Supabase Edge Function: check-subscription (Rate-Limited)
// This version includes 1-minute safety cooldown, normalization, Unix timestamps, and HMAC signatures.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1"

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function createSignature(payload: string, secret: string) {
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    )
    const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload))
    return Array.from(new Uint8Array(signature))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        const { device_code, build_fingerprint = '' } = await req.json()
        if (!device_code) {
            return new Response(JSON.stringify({ error: 'device_code is required' }), { status: 400, headers: corsHeaders })
        }

        const normalizedCode = device_code.trim().toUpperCase()

        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('APP_SERVICE_ROLE_KEY') ?? ''
        )

        // 1. Fetch Global Settings (Level, URL, Fingerprint)
        const { data: globalData, error: globalError } = await supabaseClient
            .from('settings')
            .select('key, value')
            .in('key', ['global_update_level', 'update_url', 'latest_fingerprint'])
        
        const globalLevelStr = globalData?.find((s: any) => s.key === 'global_update_level')?.value || '0'
        const globalLevel = parseInt(globalLevelStr)
        const updateUrl = globalData?.find((s: any) => s.key === 'update_url')?.value || ''
        const latestFingerprint = globalData?.find((s: any) => s.key === 'latest_fingerprint')?.value || ''

        // 2. Fetch device and its specific update_level
        const { data: device, error } = await supabaseClient
            .from('devices')
            .select('id, code, status, expiry, last_checked_at, update_level')
            .eq('code', normalizedCode)
            .single()

        if (error || !device) {
            return new Response(
                JSON.stringify({ valid: false, message: 'Device not found', status: 'Unknown' }),
                { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // 3. Rate Limit Logic (1-minute safety cooldown)
        const now = new Date()
        if (device.last_checked_at) {
            const lastCheck = new Date(device.last_checked_at)
            const diffInSeconds = (now.getTime() - lastCheck.getTime()) / 1000

            if (diffInSeconds < 60) {
                return new Response(
                    JSON.stringify({
                        error: 'Too many requests. Please wait 60 seconds.',
                        retry_after: Math.ceil(60 - diffInSeconds)
                    }),
                    { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
                )
            }
        }

        // 4. Update last_checked_at immediately
        await supabaseClient
            .from('devices')
            .update({ last_checked_at: now.toISOString() })
            .eq('id', device.id)

        const expiryDate = new Date(device.expiry)
        let isValid = true
        let message = 'Subscription active'
        let currentStatus = device.status

        if (device.status === 'Banned') {
            isValid = false
            message = 'Device is banned'
        } else if (expiryDate < now) {
            isValid = false
            message = 'Subscription expired'
            currentStatus = 'Expired'

            if (device.status === 'Active') {
                await supabaseClient.from('devices').update({ status: 'Expired' }).eq('id', device.id)
            }
        }

        // 5. Build Fingerprint Auto-Clear Logic
        let effectiveUpdateLevel = Math.max(device.update_level || 0, globalLevel)
        
        // If user is running the "Latest" version, they are NEVER blocked
        if (build_fingerprint && build_fingerprint === latestFingerprint) {
            effectiveUpdateLevel = 0
            
            // Auto-clear individual device block if it existed
            if (device.update_level > 0) {
                await supabaseClient
                    .from('devices')
                    .update({ update_level: 0 })
                    .eq('id', device.id)
            }
        }

        // 6. Prepare Response
        const expiryTs = Math.floor(expiryDate.getTime() / 1000)
        const responseData: any = {
            valid: isValid,
            device_code: normalizedCode,
            status: currentStatus,
            expiry_ts: expiryTs,
            message: message,
            update_level: effectiveUpdateLevel,
            update_url: updateUrl
        }

        const signingSecret = Deno.env.get('SIGNING_SECRET')
        if (signingSecret) {
            const signString = `${normalizedCode}:${expiryTs}:${currentStatus}:${effectiveUpdateLevel}`
            responseData.signature = await createSignature(signString, signingSecret)
        }

        return new Response(
            JSON.stringify(responseData),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders })
    }
})
