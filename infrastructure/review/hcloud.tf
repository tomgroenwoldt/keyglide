variable "hcloud_token" {
    type = string
}

provider "hcloud" {
    token = "${var.hcloud_token}"
}

resource "hcloud_server" "web" {
  name        = "keyglide-review"
  image       = "ubuntu-20.04"
  server_type = "cx22"
  ssh_keys = [hcloud_ssh_key.default.id]
  user_data = file("user-data.yml")
  firewall_ids = [hcloud_firewall.myfirewall.id]
}

resource "hcloud_ssh_key" "default" {
  name       = "review"
  public_key = file("../../secrets/review_ssh_key.pub")
}

resource "hcloud_firewall" "myfirewall" {
  name = "my-firewall"
  # Allow to ping server
  rule {
    direction = "in"
    protocol  = "icmp"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }
  # Allow SSH
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "22"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }
  # Allow communication to backend
  rule {
    direction = "in"
    protocol  = "tcp"
    port      = "3030"
    source_ips = [
      "0.0.0.0/0",
      "::/0"
    ]
  }

}
