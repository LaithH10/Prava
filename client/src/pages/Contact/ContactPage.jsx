import React from "react";
import { Link } from "react-router-dom";

// Minimal contact page. No contact details are shown until real ones are decided;
// a contact form comes later, once its backend, privacy and spam protection exist.
const ContactPage = () => {
  return (
    <div className="wrapper">
      <div className="flexColStart paddings innerWidth" style={{ gap: "1rem", minHeight: "50vh" }}>
        <span className="orangeText">Contact</span>
        <span className="primaryText">Get in touch with Prava</span>
        <span className="secondaryText">
          A contact form is coming soon.
          <br />
          In the meantime, you can browse the available properties.
        </span>
        <Link className="button" to="/properties">
          View properties
        </Link>
      </div>
    </div>
  );
};

export default ContactPage;
