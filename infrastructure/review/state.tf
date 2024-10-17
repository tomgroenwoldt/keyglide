terraform {
    backend "s3" {
        access_key = ""
        secret_key = ""

        region = "fsn1"
        bucket = "keyglide"
        key    = "path.tfstate"

        skip_region_validation      = true
        skip_credentials_validation = true
        skip_metadata_api_check     = true
        skip_requesting_account_id  = true
        skip_s3_checksum = true

        endpoints = {
            s3 = "https://fsn1.your-objectstorage.com"
        }
    }
}
