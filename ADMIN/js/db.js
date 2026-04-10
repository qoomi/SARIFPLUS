/**
 * Database Abstraction Layer (db.js)
 * This file handles all communication with Supabase for the Devices table.
 * It provides a clean interface for the main application logic.
 */

const DeviceDB = {
    tableName: 'devices',

    /**
     * Fetch all devices from Supabase
     * @returns {Promise<Array>} List of devices
     */
    async getDevices() {
        if (!window.supabaseClient) {
            return [];
        }
        // Use a direct join. Default alias for related table is its name.
        const { data, error } = await window.supabaseClient
            .from(this.tableName)
            .select('*, device_details (username, amount, description)')
            .order('created_at', { ascending: false });

        if (error) {
            return [];
        }

        // Flatten the data for easier UI consumption with safety defaults
        return data.map(d => {
            const details = Array.isArray(d.device_details) ? d.device_details[0] : d.device_details;
            
            return {
                ...d,
                id: d.id || 0,
                code: d.code || 'UNKNOWN',
                status: d.status || 'Active',
                expiry: d.expiry || new Date().toISOString(),
                username: details?.username || 'N/A', // Default fallback
                amount: details?.amount || 0,         // Default fallback
                description: details?.description || '' // Default fallback
            };
        });
    },

    /**
     * Add a new device to Supabase
     * @param {Object} device Device data
     * @returns {Promise<Object|null>} The created device or null on error
     */
    async addDevice(deviceData) {
        try {
            console.log('db.js: Attempting atomic device creation via RPC...');
            
            // Call the custom RPC function that handles both tables in one transaction
            const { data, error } = await window.supabaseClient.rpc('create_device_with_details', {
                p_code: deviceData.code,
                p_expiry: deviceData.expiry,
                p_username: deviceData.username,
                p_amount: deviceData.amount,
                p_description: deviceData.description
            });

            if (error) {
                return null;
            }

            // Return combined object for the UI
            return {
                ...deviceData,
                id: data.id
            };
        } catch (err) {
            console.error('db.js: Runtime error during atomic add:', err);
            return null;
        }
    },

    /**
     * Update an existing device
     * @param {number|string} id Device ID
     * @param {Object} updates Fields to update
     * @returns {Promise<boolean>} Success status
     */
    async updateDevice(id, updates) {
        try {
            const { data, error } = await window.supabaseClient
                .from(this.tableName)
                .update(updates)
                .eq('id', id)
                .select();

            if (error) {
                console.error('Error updating device:', error);
                return false;
            }

            if (!data || data.length === 0) {
                console.warn('Update successful but no rows matched the ID:', id);
                return false;
            }
            return true;
        } catch (err) {
            console.error('Runtime error updating device:', err);
            return false;
        }
    },

    /**
     * Update extended device details (Name, Amount, Description)
     * Uses upsert to create the record if it doesn't exist (for older devices)
     */
    async updateDeviceDetails(deviceId, details) {
        try {
            console.log(`db.js: Upserting details for device ${deviceId}...`, details);
            
            // With UNIQUE constraint on device_id, upsert will either insert or update based on conflict
            const { data, error } = await window.supabaseClient
                .from('device_details')
                .upsert({
                    device_id: deviceId,
                    ...details
                }, { 
                    onConflict: 'device_id',
                    ignoreDuplicates: false 
                })
                .select();

            if (error) {
                console.error('Error upserting device details:', error);
                
                // Fallback: If upsert STILL fails (e.g. constraint not applied yet), try separate update
                const { error: updateError } = await window.supabaseClient
                    .from('device_details')
                    .update(details)
                    .eq('device_id', deviceId);

                if (updateError) {
                    console.error('Fallback update also failed:', updateError);
                    return false;
                }
            }
            return true;
        } catch (err) {
            console.error('Runtime error saving device details:', err);
            return false;
        }
    },

    /**
     * Update individual device update_level
     */
    async updateDeviceLevel(deviceId, level) {
        try {
            const { error } = await window.supabaseClient
                .from('devices')
                .update({ update_level: parseInt(level) })
                .eq('id', deviceId);
            if (error) {
                console.error('Error updating device level:', error);
                return false;
            }
            return true;
        } catch (err) {
            console.error('Runtime error updating device level:', err);
            return false;
        }
    },

    /**
     * Fetch all system settings
     */
    async getSettings() {
        if (!window.supabaseClient) return [];
        const { data, error } = await window.supabaseClient
            .from('settings')
            .select('*');
        if (error) {
            console.error('Error fetching settings:', error);
            return [];
        }
        return data;
    },

    /**
     * Update a system setting (Global Level or URL)
     */
    async updateSetting(key, value) {
        try {
            const { error } = await window.supabaseClient
                .from('settings')
                .update({ value, updated_at: new Date().toISOString() })
                .eq('key', key);
            if (error) {
                console.error(`Error updating setting ${key}:`, error);
                return false;
            }
            return true;
        } catch (err) {
            console.error('Runtime error updating setting:', err);
            return false;
        }
    },

    /**
     * Delete a device from Supabase
     * @param {number|string} id Device ID
     * @returns {Promise<boolean>} Success status
     */
    async deleteDevice(id) {
        try {
            const { data, error } = await window.supabaseClient
                .from(this.tableName)
                .delete()
                .eq('id', id)
                .select();

            if (error) {
                console.error('Error deleting device:', error);
                return false;
            }

            if (!data || data.length === 0) {
                console.warn('Delete successful but no rows matched the ID:', id);
                return false;
            }
            return true;
        } catch (err) {
            console.error('Runtime error deleting device:', err);
            return false;
        }
    }
};

// Export to window
window.DeviceDB = DeviceDB;
