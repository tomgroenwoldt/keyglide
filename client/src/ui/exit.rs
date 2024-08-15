use ratatui::{
    style::{Color, Style},
    widgets::{Block, Paragraph},
    Frame,
};

use crate::config::Config;

use super::centered_rect;

pub fn draw_exit(f: &mut Frame, config: &Config) {
    let popup = Block::bordered()
        .title("Exit?")
        .border_style(Style::default().fg(Color::LightRed));
    let text = format!(
        "Confirm <{}>, Abort <{}>",
        config.key_bindings.popup.confirm.code, config.key_bindings.popup.abort.code
    );
    let area = centered_rect(f.area(), text.len() as u16, 1);
    let paragraph = Paragraph::new(text).block(popup);
    f.render_widget(paragraph, area);
}
