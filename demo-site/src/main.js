
import "./style.css";

const registrationForm = document.querySelector("#registration-form");
const registrationMessage = document.querySelector("#registration-message");

const contactForm = document.querySelector("#contact-form");
const contactMessage = document.querySelector("#contact-message");

registrationForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!registrationForm.checkValidity()) {
    registrationForm.reportValidity();
    return;
  }

  registrationMessage.textContent =
    "Registration form submitted successfully!";
  registrationMessage.dataset.status = "success";
});

contactForm?.addEventListener("submit", (event) => {
  event.preventDefault();

  if (!contactForm.checkValidity()) {
    contactForm.reportValidity();
    return;
  }

  contactMessage.textContent =
    "Contact form submitted successfully!";
  contactMessage.dataset.status = "success";
});
