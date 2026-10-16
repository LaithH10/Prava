import React from "react";
import { Link } from "react-router-dom";
import "./GetStarted.css";
const GetStarted = () => {
  return (
    <div id="get-started" className="g-wrapper">
      <div className="paddings innerWidth g-container">
        <div className="flexColCenter inner-container">
          <span className="primaryText">Get started with Prava</span>
          <span className="secondaryText">
            Subscribe and find super attractive price quotes from us.
            <br />
            Find your residence soon
          </span>
          <Link className="button" to="/properties">
            Get Started
          </Link>
        </div>
      </div>
    </div>
  );
};

export default GetStarted;
